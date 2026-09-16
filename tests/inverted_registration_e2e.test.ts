import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { resetRateLimits } from '../src/services/rateLimiter.js';
import type { FastifyInstance } from 'fastify';

describe('Inverted Registration End-to-End Flow', () => {
    let app: FastifyInstance;
    let serverPort: number;

    before(async () => {
        config.NODE_ENV = 'test';
        config.CLOUDFLARE_TURNSTILE_SECRET_KEY = '';
        resetRateLimits();

        app = buildApp();
        // Start listening on dynamic port for real WebSocket connection
        await app.listen({ port: 0, host: '127.0.0.1' });
        const address = app.server.address();
        if (typeof address === 'object' && address !== null) {
            serverPort = address.port;
        } else {
            throw new Error('Failed to obtain server address');
        }
    });

    after(async () => {
        await app.close();
        await prisma.$disconnect();
    });

    it('completes full inverted registration flow (API -> Bot .verify -> WS emit -> JWT auth)', async () => {
        const testPhone = '6281298765432';
        const canonicalJid = `${testPhone}@s.whatsapp.net`;

        // Ensure clean state
        await prisma.otpVerification.deleteMany({ where: { phoneNumber: testPhone } });
        await prisma.whitelistedGroup.deleteMany({ where: { ownerJid: canonicalJid } });
        await prisma.subscription.deleteMany({ where: { userId: canonicalJid } });
        await prisma.user.deleteMany({ where: { id: canonicalJid } });

        // Step 1: Web client submits inverted registration
        const regRes = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/register-inverted',
            payload: {
                phone: testPhone,
                username: 'razaeltester',
                email: 'razael@example.com',
                password: 'supersecretpassword123',
                turnstileToken: 'mock-turnstile-token'
            }
        });

        assert.strictEqual(regRes.statusCode, 200);
        const regData = regRes.json() as {
            token: string;
            clickToChatUrl: string;
            regSessionId: string;
            expiresIn: number;
        };

        assert.ok(regData.token);
        assert.ok(regData.regSessionId);
        assert.strictEqual(regData.expiresIn, 1800);
        assert.match(regData.token, /^COSMOS-[0-9A-F]{6}-5432$/);
        assert.ok(regData.clickToChatUrl.includes(encodeURIComponent(`.verify ${regData.token}`)));

        // Step 2: Open WebSocket connection to listen for verification status
        const wsUrl = `ws://127.0.0.1:${serverPort}/ws/auth/status?session=${encodeURIComponent(regData.regSessionId)}`;
        const ws = new WebSocket(wsUrl);

        const wsMessagePromise = new Promise<{ status: string; jwtToken?: string }>((resolve, reject) => {
            const timer = setTimeout(() => {
                ws.close();
                reject(new Error('WebSocket verification response timed out'));
            }, 6000);

            ws.addEventListener('message', (event) => {
                try {
                    const parsed = JSON.parse(event.data.toString());
                    if (parsed.status === 'VERIFIED') {
                        clearTimeout(timer);
                        resolve(parsed);
                    }
                } catch (err) {
                    reject(err);
                }
            });

            ws.addEventListener('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });

        // Wait brief tick for WS to establish
        await new Promise((r) => setTimeout(r, 200));

        // Step 3: Simulate WhatsApp bot executing `.verify <token>` from the registered phone
        // In the bot engine (`src/tools/verify.ts`), upon receiving `.verify`, it:
        // 1. Updates OtpVerification isUsed = true
        // 2. Upserts User (isWhitelisted = true, metadata)
        // 3. Upserts Subscription (FREE, ACTIVE)
        await prisma.$transaction([
            prisma.otpVerification.update({
                where: { regSessionId: regData.regSessionId },
                data: { isUsed: true }
            }),
            prisma.user.upsert({
                where: { id: canonicalJid },
                update: {
                    isWhitelisted: true,
                    username: 'razaeltester',
                    email: 'razael@example.com'
                },
                create: {
                    id: canonicalJid,
                    username: 'razaeltester',
                    email: 'razael@example.com',
                    isWhitelisted: true
                }
            }),
            prisma.subscription.upsert({
                where: { userId: canonicalJid },
                update: { status: 'ACTIVE' },
                create: { userId: canonicalJid, tier: 'FREE', maxSubBots: 2, maxGroups: 5, status: 'ACTIVE' }
            })
        ]);

        // Step 4: Verify WebSocket received the VERIFIED event with JWT token
        const wsResult = await wsMessagePromise;
        assert.strictEqual(wsResult.status, 'VERIFIED');
        assert.ok(wsResult.jwtToken, 'WebSocket must yield a valid JWT token');

        // Step 5: Test that the JWT token authenticates successfully
        const subRes = await app.inject({
            method: 'GET',
            url: '/api/v1/subscriptions/status',
            headers: {
                authorization: `Bearer ${wsResult.jwtToken}`
            }
        });

        assert.strictEqual(subRes.statusCode, 200);
        const subData = subRes.json() as {
            tier: string;
            status: string;
            maxSubBots: number;
            maxGroups: number;
        };
        assert.strictEqual(subData.tier, 'FREE');
        assert.strictEqual(subData.status, 'ACTIVE');
        assert.strictEqual(subData.maxSubBots, 2);
        assert.strictEqual(subData.maxGroups, 5);

        // Step 6: Test HTTP fallback polling /api/v1/auth/status
        const statusPollRes = await app.inject({
            method: 'GET',
            url: `/api/v1/auth/status?session=${encodeURIComponent(regData.regSessionId)}`
        });
        assert.strictEqual(statusPollRes.statusCode, 200);
        assert.strictEqual(statusPollRes.json().status, 'VERIFIED');
    });
});
