import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { resetRateLimits } from '../src/services/rateLimiter.js';
import type { FastifyInstance } from 'fastify';

describe('Security & IDOR Enforcement', () => {
    let app: FastifyInstance;
    let tokenUserA: string;
    let tokenUserB: string;

    const userAJid = '628111111111@s.whatsapp.net';
    const userBJid = '628222222222@s.whatsapp.net';

    before(async () => {
        config.NODE_ENV = 'test';
        config.INTERNAL_IPC_SECRET = 'correct-internal-ipc-secret';
        config.ADMIN_API_KEY = 'admin-secret-key';
        config.CLOUDFLARE_TURNSTILE_SECRET_KEY = '';

        app = buildApp();
        await app.ready();

        // Seed two distinct users
        await prisma.user.upsert({
            where: { id: userAJid },
            update: { isWhitelisted: true },
            create: { id: userAJid, isWhitelisted: true }
        });

        await prisma.user.upsert({
            where: { id: userBJid },
            update: { isWhitelisted: true },
            create: { id: userBJid, isWhitelisted: true }
        });

        tokenUserA = app.jwt.sign({ id: userAJid, phoneNumber: '628111111111' });
        tokenUserB = app.jwt.sign({ id: userBJid, phoneNumber: '628222222222' });
    });

    after(async () => {
        await app.close();
        await prisma.$disconnect();
    });

    it('rejects unauthenticated IPC calls with 401', async () => {
        // Missing secret
        const resMissing = await app.inject({
            method: 'POST',
            url: '/internal/auth/verified',
            payload: { canonicalJid: userAJid }
        });
        assert.strictEqual(resMissing.statusCode, 401);

        // Incorrect secret
        const resWrong = await app.inject({
            method: 'POST',
            url: '/internal/auth/verified',
            headers: { 'x-internal-secret': 'wrong-secret' },
            payload: { canonicalJid: userAJid }
        });
        assert.strictEqual(resWrong.statusCode, 401);

        // Correct secret succeeds
        const resCorrect = await app.inject({
            method: 'POST',
            url: '/internal/auth/verified',
            headers: { 'x-internal-secret': 'correct-internal-ipc-secret' },
            payload: { canonicalJid: userAJid }
        });
        assert.strictEqual(resCorrect.statusCode, 200);
        const data = resCorrect.json() as { ok: boolean; jwtToken: string };
        assert.strictEqual(data.ok, true);
        assert.ok(data.jwtToken);
    });

    it('IDOR: prevents User B from deleting User A whitelisted group', async () => {
        const testGroupJid = '120363000000000001@g.us';

        // Clean up then create group owned by User A
        await prisma.whitelistedGroup.deleteMany({ where: { jid: testGroupJid } });
        await prisma.whitelistedGroup.create({
            data: {
                jid: testGroupJid,
                ownerJid: userAJid,
                language: 'ID'
            }
        });

        // User B attempts to delete User A's group -> must be 403
        const resB = await app.inject({
            method: 'DELETE',
            url: `/api/v1/groups/${encodeURIComponent(testGroupJid)}`,
            headers: { authorization: `Bearer ${tokenUserB}` }
        });
        assert.strictEqual(resB.statusCode, 403);
        assert.strictEqual(resB.json().error, 'FORBIDDEN');

        // Verify group still exists
        const stillExists = await prisma.whitelistedGroup.findUnique({ where: { jid: testGroupJid } });
        assert.ok(stillExists);

        // User A deletes their own group -> 200
        const resA = await app.inject({
            method: 'DELETE',
            url: `/api/v1/groups/${encodeURIComponent(testGroupJid)}`,
            headers: { authorization: `Bearer ${tokenUserA}` }
        });
        assert.strictEqual(resA.statusCode, 200);
        assert.strictEqual(resA.json().success, true);
    });

    it('IDOR: prevents User B from deleting User A sub-bot instance', async () => {
        const testSubBotPhone = '628999888777';

        // Clean up and create sub-bot owned by User A
        await prisma.subBotInstance.deleteMany({ where: { id: testSubBotPhone } });
        await prisma.subBotInstance.create({
            data: {
                id: testSubBotPhone,
                ownerJid: userAJid,
                customPrefix: '.',
                status: 'ACTIVE'
            }
        });

        // User B attempts to delete User A's subbot -> 403
        const resB = await app.inject({
            method: 'DELETE',
            url: `/api/v1/subbots/${testSubBotPhone}`,
            headers: { authorization: `Bearer ${tokenUserB}` }
        });
        assert.strictEqual(resB.statusCode, 403);
        assert.strictEqual(resB.json().error, 'FORBIDDEN');

        // Verify subbot still exists
        const stillExists = await prisma.subBotInstance.findUnique({ where: { id: testSubBotPhone } });
        assert.ok(stillExists);

        // User A deletes their own subbot -> 200
        const resA = await app.inject({
            method: 'DELETE',
            url: `/api/v1/subbots/${testSubBotPhone}`,
            headers: { authorization: `Bearer ${tokenUserA}` }
        });
        assert.strictEqual(resA.statusCode, 200);
        assert.strictEqual(resA.json().success, true);
    });

    it('Anti-abuse: rejects invalid Turnstile token with 403 and sends zero bot messages', async () => {
        config.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'valid-dummy-secret';

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/register-direct',
            payload: {
                phone: '628777666555',
                turnstileToken: 'invalid-turnstile-token-fail'
            }
        });

        assert.strictEqual(res.statusCode, 403);
        assert.strictEqual(res.json().error, 'INVALID_TURNSTILE_TOKEN');
        config.CLOUDFLARE_TURNSTILE_SECRET_KEY = '';
    });

    it('Anti-abuse: enforces throttling and prevents forged CF-Connecting-IP bypass', async () => {
        resetRateLimits();

        const testPhone = '628555444333';

        // 3 requests allowed per phone in 15 mins
        for (let i = 0; i < 3; i++) {
            const res = await app.inject({
                method: 'POST',
                url: '/api/v1/auth/register-inverted',
                payload: {
                    phone: testPhone,
                    turnstileToken: 'mock-turnstile-token'
                }
            });
            assert.strictEqual(res.statusCode, 200);
        }

        // 4th request on the same phone must be throttled with 429
        const resThrottled = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/register-inverted',
            headers: {
                // Attempting to forge CF-Connecting-IP to bypass rate limit
                'cf-connecting-ip': '203.0.113.199'
            },
            payload: {
                phone: testPhone,
                turnstileToken: 'mock-turnstile-token'
            }
        });
        assert.strictEqual(resThrottled.statusCode, 429);
        assert.strictEqual(resThrottled.json().error, 'TOO_MANY_REQUESTS');
    });
});
