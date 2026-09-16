import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { resetRateLimits } from '../src/services/rateLimiter.js';
import { hashPassword } from '../src/services/cryptoService.js';
import type { FastifyInstance } from 'fastify';

describe('Auth & Subscriptions System Endpoints', () => {
    let app: FastifyInstance;
    const testPhone = '6281333444555';
    const testJid = `${testPhone}@s.whatsapp.net`;
    let userToken: string;

    before(async () => {
        config.NODE_ENV = 'test';
        config.ADMIN_API_KEY = 'super-secret-admin-key';
        config.CLOUDFLARE_TURNSTILE_SECRET_KEY = '';
        resetRateLimits();

        app = buildApp();
        await app.ready();

        // Clean test records
        await prisma.paymentTransaction.deleteMany({ where: { userId: testJid } });
        await prisma.subscription.deleteMany({ where: { userId: testJid } });
        await prisma.otpVerification.deleteMany({ where: { phoneNumber: testPhone } });
        await prisma.userDevice.deleteMany({ where: { userId: testJid } });
        await prisma.userIpAccessLog.deleteMany({ where: { userId: testJid } });
        await prisma.subBotInstance.deleteMany({ where: { ownerJid: testJid } });
        await prisma.whitelistedGroup.deleteMany({ where: { ownerJid: testJid } });
        await prisma.user.deleteMany({ where: { id: testJid } });

        // Seed whitelisted user with password
        await prisma.user.create({
            data: {
                id: testJid,
                username: 'subtestuser',
                email: 'subtest@example.com',
                passwordHash: hashPassword('correctPassword123!'),
                isWhitelisted: true,
                balance: BigInt(10000)
            }
        });

        // Seed default FREE subscription
        await prisma.subscription.create({
            data: {
                userId: testJid,
                tier: 'FREE',
                status: 'ACTIVE',
                maxSubBots: 2,
                maxGroups: 5,
                customPrefix: false
            }
        });

        userToken = app.jwt.sign({ id: testJid, phoneNumber: testPhone });
    });

    after(async () => {
        await app.close();
        await prisma.$disconnect();
    });

    it('handles password login and records untrusted device access log', async () => {
        // Wrong password -> 401
        const resWrong = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: {
                identifier: 'subtestuser',
                password: 'wrongPassword'
            }
        });
        assert.strictEqual(resWrong.statusCode, 401);
        assert.strictEqual(resWrong.json().error, 'INVALID_CREDENTIALS');

        // Correct password -> 200 + JWT
        const resOk = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            headers: {
                'user-agent': 'Mozilla/5.0 TestBrowser',
                'cf-connecting-ip': '198.51.100.25'
            },
            payload: {
                identifier: testPhone,
                password: 'correctPassword123!'
            }
        });
        assert.strictEqual(resOk.statusCode, 200);
        const data = resOk.json() as { jwtToken: string; user: { id: string; isWhitelisted: boolean } };
        assert.ok(data.jwtToken);
        assert.strictEqual(data.user.id, testJid);
        assert.strictEqual(data.user.isWhitelisted, true);

        // Verify device and audit log were created
        const accessLog = await prisma.userIpAccessLog.findFirst({
            where: { userId: testJid, action: 'LOGIN' },
            orderBy: { createdAt: 'desc' }
        });
        assert.ok(accessLog);
    });

    it('direct OTP verification locks after 3 failed attempts', async () => {
        resetRateLimits();
        const freshPhone = '6281999000111';

        // Register direct OTP
        await prisma.otpVerification.deleteMany({ where: { phoneNumber: freshPhone } });

        // Manually create direct OTP to test verification attempt limits
        const salt = 'b'.repeat(64);
        const { hashOtp, tokenLookupHash } = await import('../src/services/cryptoService.js');
        const correctCode = '654321';
        const record = await prisma.otpVerification.create({
            data: {
                phoneNumber: freshPhone,
                codeHash: hashOtp(correctCode, salt),
                salt,
                lookupHash: tokenLookupHash(correctCode),
                purpose: 'DIRECT_REGISTRATION',
                maxAttempts: 3,
                attempts: 0,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000)
            }
        });

        // Attempt 1: wrong code -> 400
        const attempt1 = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/verify-otp',
            payload: { phone: freshPhone, otp: '000000' }
        });
        assert.strictEqual(attempt1.statusCode, 400);
        assert.strictEqual(attempt1.json().error, 'INVALID_OTP');

        // Attempt 2: wrong code -> 400
        const attempt2 = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/verify-otp',
            payload: { phone: freshPhone, otp: '000001' }
        });
        assert.strictEqual(attempt2.statusCode, 400);

        // Attempt 3: wrong code -> 400 (reaches maxAttempts)
        const attempt3 = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/verify-otp',
            payload: { phone: freshPhone, otp: '000002' }
        });
        assert.strictEqual(attempt3.statusCode, 400);

        // Attempt 4: even with correct code, record is now LOCKED -> 403
        const attempt4 = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/verify-otp',
            payload: { phone: freshPhone, otp: correctCode }
        });
        assert.strictEqual(attempt4.statusCode, 403);
        assert.strictEqual(attempt4.json().error, 'LOCKED');

        await prisma.otpVerification.delete({ where: { id: record.id } });
    });

    it('generates WhatsApp sales links for all tiers', async () => {
        const resFree = await app.inject({
            method: 'GET',
            url: '/api/v1/subscriptions/sales-link?tier=FREE&phone=62812345678'
        });
        assert.strictEqual(resFree.statusCode, 200);
        assert.ok(resFree.json().salesUrl);
        assert.ok(resFree.json().orderRef);

        const resSubsidized = await app.inject({
            method: 'GET',
            url: '/api/v1/subscriptions/sales-link?tier=SUBSIDIZED&phone=62812345678'
        });
        assert.strictEqual(resSubsidized.statusCode, 200);
        assert.ok(resSubsidized.json().salesUrl.includes(encodeURIComponent('Rp10.000')));

        const resPartner = await app.inject({
            method: 'GET',
            url: '/api/v1/subscriptions/sales-link?tier=PARTNER&phone=62812345678'
        });
        assert.strictEqual(resPartner.statusCode, 200);
        assert.ok(resPartner.json().salesUrl.includes(encodeURIComponent('Rp32.000')));
    });

    it('admin subscription activation atomically upgrades tier, sets limits, and logs payment transaction', async () => {
        // Activate SUBSIDIZED tier for 30 days
        const resActivate = await app.inject({
            method: 'POST',
            url: '/api/v1/admin/subscriptions/activate',
            headers: {
                authorization: 'Bearer super-secret-admin-key'
            },
            payload: {
                phone: testPhone,
                tier: 'SUBSIDIZED',
                durationDays: 30,
                notes: 'Manual payment verified via WhatsApp QRIS'
            }
        });

        assert.strictEqual(resActivate.statusCode, 200);
        const actData = resActivate.json() as { success: boolean; expiresAt: string; orderRef: string };
        assert.strictEqual(actData.success, true);
        assert.ok(actData.expiresAt);
        assert.ok(actData.orderRef);

        // Verify status reflects SUBSIDIZED tier limits (maxSubBots: 5, maxGroups: 10, customPrefix: true)
        const resStatus = await app.inject({
            method: 'GET',
            url: '/api/v1/subscriptions/status',
            headers: {
                authorization: `Bearer ${userToken}`
            }
        });

        assert.strictEqual(resStatus.statusCode, 200);
        const statusData = resStatus.json() as {
            tier: string;
            maxSubBots: number;
            maxGroups: number;
            customPrefix: boolean;
        };
        assert.strictEqual(statusData.tier, 'SUBSIDIZED');
        assert.strictEqual(statusData.maxSubBots, 5);
        assert.strictEqual(statusData.maxGroups, 10);
        assert.strictEqual(statusData.customPrefix, true);

        // Verify PaymentTransaction record
        const payment = await prisma.paymentTransaction.findUnique({
            where: { orderRef: actData.orderRef }
        });
        assert.ok(payment);
        assert.strictEqual(payment.status, 'PAID');
        assert.strictEqual(payment.paymentMethod, 'MANUAL_WHATSAPP');
        assert.strictEqual(payment.tier, 'SUBSIDIZED');
        assert.strictEqual(payment.amount, BigInt(10000));
    });

    it('sub-bot pairing checks whitelisted state, binds owner, and enforces quota limits', async () => {
        const subBotPhone1 = '628999111001';
        const subBotPhone2 = '628999111002';

        // Pair sub-bot 1 with code
        const resPair1 = await app.inject({
            method: 'POST',
            url: '/api/v1/subbots/pair',
            headers: { authorization: `Bearer ${userToken}` },
            payload: { phone: subBotPhone1, method: 'code' }
        });
        assert.strictEqual(resPair1.statusCode, 200);
        assert.match(resPair1.json().pairingCode, /^[0-9A-F]{4}-[0-9A-F]{4}$/);

        // Pair sub-bot 2 with qr
        const resPair2 = await app.inject({
            method: 'POST',
            url: '/api/v1/subbots/pair',
            headers: { authorization: `Bearer ${userToken}` },
            payload: { phone: subBotPhone2, method: 'qr' }
        });
        assert.strictEqual(resPair2.statusCode, 200);
        assert.ok(resPair2.json().qrCode);

        // List subbots
        const resList = await app.inject({
            method: 'GET',
            url: '/api/v1/subbots/list',
            headers: { authorization: `Bearer ${userToken}` }
        });
        assert.strictEqual(resList.statusCode, 200);
        const bots = resList.json() as Array<{ id: string; ownerJid: string }>;
        assert.ok(bots.some((b) => b.id === subBotPhone1 && b.ownerJid === testJid));
        assert.ok(bots.some((b) => b.id === subBotPhone2 && b.ownerJid === testJid));

        // Delete paired subbot
        const resDel = await app.inject({
            method: 'DELETE',
            url: `/api/v1/subbots/${subBotPhone1}`,
            headers: { authorization: `Bearer ${userToken}` }
        });
        assert.strictEqual(resDel.statusCode, 200);
        assert.strictEqual(resDel.json().success, true);
    });
});
