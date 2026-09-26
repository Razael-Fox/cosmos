import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';

test('Decision API Routes Suite', async (t) => {
    const app = buildApp();
    await app.ready();

    await t.test('POST /api/v1/decision/intent rejects unauthenticated access', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/decision/intent',
            payload: { state: 'Halo apa kabar' }
        });

        assert.equal(res.statusCode, 401);
        const data = res.json();
        assert.equal(data.error, 'UNAUTHORIZED');
    });

    await t.test('POST /api/v1/decision/intent accepts internal secret and validates payload', async () => {
        const secret = config.INTERNAL_IPC_SECRET || 'test-secret';
        config.INTERNAL_IPC_SECRET = secret;

        // Invalid payload
        const badRes = await app.inject({
            method: 'POST',
            url: '/api/v1/decision/intent',
            headers: { 'x-internal-secret': secret },
            payload: {}
        });
        assert.equal(badRes.statusCode, 400);

        // Valid payload (should invoke classification and return fallback/laya result without crashing)
        const validRes = await app.inject({
            method: 'POST',
            url: '/api/v1/decision/intent',
            headers: { 'x-internal-secret': secret },
            payload: { state: 'Kirimkan uang ke rekening contact_ref_12345' }
        });
        assert.equal(validRes.statusCode, 200);
        const data = validRes.json();
        assert.equal(data.ok, true);
        assert.ok(data.data.intent);
        assert.ok(data.data.recipientCategory);
    });

    await t.test('POST /api/v1/decision/loan evaluates credit metrics with fallback', async () => {
        const secret = config.INTERNAL_IPC_SECRET;

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/decision/loan',
            headers: { 'x-internal-secret': secret },
            payload: {
                creditScore: 780,
                reputation: 'Excellent',
                netWorthTier: 'high',
                requestedAmount: 25000000,
                pastRepaymentsCount: 8,
                pastDefaultsCount: 0,
                hasCollateral: true
            }
        });

        assert.equal(res.statusCode, 200);
        const data = res.json();
        assert.equal(data.ok, true);
        assert.equal(data.data.recommendation, 'approved');
        assert.ok(data.data.suggestedInterestRate >= 0.02 && data.data.suggestedInterestRate <= 0.15);
        assert.ok(data.data.suggestedTermDays >= 7 && data.data.suggestedTermDays <= 30);
    });

    await t.test('POST /api/v1/decision/loan rejects below 450 credit score', async () => {
        const secret = config.INTERNAL_IPC_SECRET;

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/decision/loan',
            headers: { 'x-internal-secret': secret },
            payload: {
                creditScore: 400,
                reputation: 'Poor',
                netWorthTier: 'low',
                requestedAmount: 5000000,
                pastRepaymentsCount: 1,
                pastDefaultsCount: 3,
                hasCollateral: false
            }
        });

        assert.equal(res.statusCode, 200);
        const data = res.json();
        assert.equal(data.ok, true);
        assert.equal(data.data.recommendation, 'rejected');
    });

    await app.close();
});
