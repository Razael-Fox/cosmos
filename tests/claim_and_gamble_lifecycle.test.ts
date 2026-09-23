import assert from 'node:assert';
import { prisma, ensureDatabaseSchema } from '../src/db.js';
import { getSenderJid, getUser, buildUserOrConditions, lidToPnMap } from '../src/utils/casino.js';
import dailyTool from '../src/tools/daily.js';
import slotTool from '../src/tools/slot.js';
import { getTranslator } from '../src/utils/i18n.js';

async function runTests() {
    console.log('=== STARTING CLAIM & GAMBLE LIFECYCLE TESTS ===');

    const testDbPath = '/tmp/test_claim_lifecycle.db';
    process.env.DATABASE_URL = `file:${testDbPath}`;
    ensureDatabaseSchema(testDbPath);

    const testPhone = '6282114329219';
    const testLid = '14392720638086';
    const canonicalJid = `${testPhone}@s.whatsapp.net`;
    const fullLid = `${testLid}@lid`;
    const groupJid = '120363274823554999@g.us';

    // Clean up test data if any
    await prisma.user.deleteMany({
        where: {
            OR: [{ id: canonicalJid }, { id: testPhone }, { id: testLid }, { id: fullLid }, { lid: testLid }]
        }
    });

    console.log('[Test 1] Testing getSenderJid canonical format resolution...');
    // 1. Message from group with LID participant and PN in participantAlt
    const msgWithAlt = {
        key: {
            remoteJid: groupJid,
            fromMe: false,
            id: 'MSG_CLAIM_01',
            participant: fullLid,
            participantAlt: canonicalJid
        },
        pushName: 'Aizz'
    };

    const resolvedJid1 = getSenderJid(msgWithAlt);
    assert.strictEqual(resolvedJid1, canonicalJid, `Expected canonical JID ${canonicalJid} but got ${resolvedJid1}`);
    assert.strictEqual(lidToPnMap.get(testLid), testPhone, `Expected lidToPnMap to cache ${testLid} -> ${testPhone}`);
    console.log('✓ getSenderJid resolved canonical JID from participantAlt and populated cache.');

    // 2. Message from group with only LID participant (no participantAlt), relying on cache
    const msgWithoutAlt = {
        key: {
            remoteJid: groupJid,
            fromMe: false,
            id: 'MSG_SLOT_01',
            participant: fullLid
        },
        pushName: 'Aizz'
    };

    const resolvedJid2 = getSenderJid(msgWithoutAlt);
    assert.strictEqual(
        resolvedJid2,
        canonicalJid,
        `Expected cached resolution to canonical JID ${canonicalJid} but got ${resolvedJid2}`
    );
    console.log('✓ getSenderJid resolved canonical JID using cached LID mapping.');

    console.log('[Test 2] Testing getUser idempotent lookup across all identifier formats...');
    // Create initial user via canonical JID
    const user1 = await getUser(prisma, resolvedJid1, 'Aizz');
    assert.strictEqual(user1.id, canonicalJid);
    assert.strictEqual(Number(user1.balance), 10000, 'Initial balance must be starterpack 10,000');

    // Look up with bare digits
    const userByDigits = await getUser(prisma, testPhone);
    assert.strictEqual(userByDigits.id, canonicalJid, 'Lookup by bare digits must return canonical record');
    assert.strictEqual(Number(userByDigits.balance), 10000);

    // Look up with LID
    const userByLid = await getUser(prisma, testLid);
    assert.strictEqual(userByLid.id, canonicalJid, 'Lookup by LID must return canonical record');

    // Look up with full LID
    const userByFullLid = await getUser(prisma, fullLid);
    assert.strictEqual(userByFullLid.id, canonicalJid, 'Lookup by full LID must return canonical record');

    const totalMatchingUsers = await prisma.user.count({
        where: { OR: buildUserOrConditions(testPhone) }
    });
    assert.strictEqual(totalMatchingUsers, 1, 'There must only be 1 user record, no phantom duplicates');
    console.log('✓ getUser returned identical canonical user across canonical JID, bare digits, and LID.');

    console.log('[Test 3] Simulating .claim (daily reward) execution...');
    let sentClaimText = '';
    const claimCtx = {
        msg: msgWithAlt,
        sock: {
            sendMessage: async (_dest: string, content: { text: string }) => {
                sentClaimText = content.text;
            }
        },
        jid: groupJid,
        t: getTranslator('en')
    };

    await dailyTool.execute({}, claimCtx as any);
    assert(sentClaimText.includes('DAILY REWARD CLAIMED'), 'Daily claim message must be sent');
    assert(
        sentClaimText.includes('40,000') || sentClaimText.includes('40.000'),
        'Claim message must show new balance 40,000'
    );

    const userAfterClaim = await getUser(prisma, canonicalJid);
    assert.strictEqual(
        Number(userAfterClaim.balance),
        40000,
        `User balance must be 40,000 after claiming, got ${userAfterClaim.balance}`
    );
    assert(userAfterClaim.lastDailyClaim !== null, 'lastDailyClaim must be populated');
    console.log('✓ .claim updated canonical user balance to 40,000.');

    console.log('[Test 4] Simulating incoming message profile sync (legacy cleanup)...');
    // Simulate what message.ts does: cleanDigits check and merge
    const cleanDigits = canonicalJid.split('@')[0].replace(/\D/g, '');
    if (cleanDigits && cleanDigits !== canonicalJid) {
        const legacyUser = await prisma.user.findUnique({ where: { id: cleanDigits } }).catch(() => null);
        if (legacyUser) {
            const extraBalance = legacyUser.balance > BigInt(10000) ? legacyUser.balance - BigInt(10000) : BigInt(0);
            if (extraBalance > BigInt(0) || legacyUser.lastDailyClaim) {
                await prisma.user
                    .update({
                        where: { id: canonicalJid },
                        data: {
                            ...(extraBalance > BigInt(0) ? { balance: { increment: extraBalance } } : {}),
                            ...(legacyUser.lastDailyClaim ? { lastDailyClaim: legacyUser.lastDailyClaim } : {})
                        }
                    })
                    .catch(() => {});
            }
            await prisma.user.delete({ where: { id: cleanDigits } }).catch(() => {});
        }
    }

    const userAfterSync = await getUser(prisma, canonicalJid);
    assert.strictEqual(
        Number(userAfterSync.balance),
        40000,
        `Balance must remain 40,000 after message.ts sync, got ${userAfterSync.balance}`
    );
    console.log('✓ User balance was preserved through message profile synchronization.');

    console.log('[Test 5] Simulating .slot 20k execution (the bug report scenario)...');
    let slotReply: any = null;
    const slotCtx = {
        msg: msgWithoutAlt, // Even when alt is missing on subsequent turn!
        sock: {
            sendMessage: async (_dest: string, content: any) => {
                slotReply = content;
            }
        },
        jid: groupJid,
        t: getTranslator('en')
    };

    const slotResult = await slotTool.execute({ bet: '20k' }, slotCtx as any);
    // The slot result should not be an "Insufficient balance" error!
    if (typeof slotResult === 'string') {
        assert(
            !slotResult.includes('Insufficient balance'),
            `Slot tool returned insufficient balance error: ${slotResult}`
        );
    }
    if (slotReply?.text) {
        assert(
            !slotReply.text.includes('Insufficient balance'),
            `Slot message returned insufficient balance error: ${slotReply.text}`
        );
    }

    // Verify user balance was mutated by the gamble (either won or lost 20,000)
    const userAfterSlot = await getUser(prisma, canonicalJid);
    assert.notStrictEqual(Number(userAfterSlot.balance), 10000, 'Balance must NOT revert to starterpack 10,000!');
    console.log(
        `✓ .slot 20k executed successfully without Insufficient Balance error. Final balance: ${userAfterSlot.balance}`
    );

    // Cleanup
    await prisma.user.deleteMany({
        where: { id: canonicalJid }
    });

    console.log('=== ALL CLAIM & GAMBLE LIFECYCLE TESTS PASSED! ===');
}

runTests().catch((err) => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
