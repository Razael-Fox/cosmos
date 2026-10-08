import assert from 'assert';
import fs from 'fs';

const OWNER = '628999999999';
const USER = '628111111111@s.whatsapp.net';

// The tier lookup hits Prisma, so point it at a throwaway SQLite file instead of
// the deployment database. Imported lazily because ESM hoists static imports.
const testDb = '/tmp/opencode/feature-limits-test.sqlite';
fs.mkdirSync('/tmp/opencode', { recursive: true });
process.env.DATABASE_URL = `file:${testDb}`;
process.env.OWNER_PHONE_NUMBER = OWNER;

const { tryConsume, usageInWindow, resolveLimit, invalidateTierCache } = await import('../src/lib/featureLimiter.js');

invalidateTierCache();

// Test 1: the sliding window admits exactly `max` hits, then rejects.
const key = 'sticker:test-window';
assert.strictEqual(tryConsume(key, 2, 60_000), true, 'first hit is admitted');
assert.strictEqual(tryConsume(key, 2, 60_000), true, 'second hit is admitted');
assert.strictEqual(tryConsume(key, 2, 60_000), false, 'third hit is rejected');
assert.strictEqual(usageInWindow(key, 60_000), 2, 'rejected hits are not counted');
console.log('✓ Sliding window admits exactly max hits per window.');

// Test 2: hits age out of the window.
const shortKey = 'sticker:test-expiry';
tryConsume(shortKey, 1, 30);
assert.strictEqual(tryConsume(shortKey, 1, 30), false, 'still limited inside the window');
await new Promise((r) => setTimeout(r, 60));
assert.strictEqual(tryConsume(shortKey, 1, 30), true, 'slot freed once the window elapsed');
console.log('✓ Hits expire with the window.');

// Test 3: tools that declare no limit are never limited.
const unlimited = await resolveLimit({ name: 'menu', description: 'menu' }, USER);
assert.strictEqual(unlimited, null, 'tool without `limit` is unlimited');
console.log('✓ Tools without a declared limit are unlimited.');

// Test 4: the owner bypasses limits, and a tool's fallback applies on FREE.
const owner = await resolveLimit(
    { name: 'stt', description: 'stt', limitKey: 'stt', limit: { max: 5, windowMs: 600_000 } },
    `${OWNER}@s.whatsapp.net`
);
assert.strictEqual(owner, null, 'owner bypasses feature limits');

const free = await resolveLimit(
    { name: 'stt', description: 'stt', limitKey: 'stt', limit: { max: 5, windowMs: 600_000 } },
    USER
);
assert(free !== null, 'declared limit resolves for a normal user');
assert(free.key === 'stt', 'counter key falls back to limitKey');
assert(free.limit.max >= 1 && free.limit.windowMs > 0, 'resolved limit carries a usable ceiling');
console.log('✓ Owner bypasses limits; a normal user resolves the tier ceiling.');
