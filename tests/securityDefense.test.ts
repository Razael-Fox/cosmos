import assert from 'assert';
import { inspectMessageForMalice } from '../src/utils/security/bugDetector.js';
import { antiSpamGuard } from '../src/utils/security/antiSpamGuard.js';
import { securityEnforcementService } from '../src/services/securityEnforcementService.js';
import { WAMessage } from '@whiskeysockets/baileys';

function createMockMsg(overrides: Partial<WAMessage> = {}): WAMessage {
    return {
        key: {
            remoteJid: '123456789@s.whatsapp.net',
            fromMe: false,
            id: 'TEST_MSG_ID_' + Math.random().toString(36).substring(7)
        },
        messageTimestamp: Date.now(),
        message: {
            conversation: 'Hello world'
        },
        ...overrides
    };
}

async function runTests(): Promise<void> {
    console.log('--- STARTING AUTOMATED SECURITY DEFENSE SYSTEM TESTS ---');

    // [Test 1] Normal message
    const normalMsg = createMockMsg({ message: { conversation: 'What are the available commands?' } });
    const normalRes = inspectMessageForMalice(normalMsg);
    assert.strictEqual(normalRes.isMalicious, false, 'Normal message should not be flagged');
    console.log('✔ Normal messages pass inspection');

    // [Test 2] Text overflow attack (> 65k characters)
    const overflowText = 'X'.repeat(70000);
    const overflowMsg = createMockMsg({ message: { conversation: overflowText } });
    const overflowRes = inspectMessageForMalice(overflowMsg);
    assert.strictEqual(overflowRes.isMalicious, true, 'Text overflow should be intercepted');
    assert.strictEqual(overflowRes.type, 'TEXT_OVERFLOW');
    console.log('✔ Text overflow attacks are blocked');

    // [Test 3] Zero-width Virtex
    const virtexText = 'Payload' + '\u200B\u200C\u200D\uFEFF'.repeat(150);
    const virtexMsg = createMockMsg({ message: { conversation: virtexText } });
    const virtexRes = inspectMessageForMalice(virtexMsg);
    assert.strictEqual(virtexRes.isMalicious, true, 'Virtex payload should be intercepted');
    assert.strictEqual(virtexRes.type, 'VIRTEX');
    console.log('✔ Virtex zero-width attacks are blocked');

    // [Test 4] Zalgo combining diacritics
    const zalgoText = 'Crash' + '\u0300\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308\u0309'.repeat(1000);
    const zalgoMsg = createMockMsg({ message: { conversation: zalgoText } });
    const zalgoRes = inspectMessageForMalice(zalgoMsg);
    assert.strictEqual(zalgoRes.isMalicious, true, 'Zalgo diacritic cascades should be intercepted');
    assert.strictEqual(zalgoRes.type, 'VIRTEX');
    console.log('✔ Zalgo diacritic cascades are blocked');

    // [Test 5] Legitimate VCard with base64 Photo
    const normalVCardWithPhoto =
        'BEGIN:VCARD\nVERSION:3.0\nN:Doe;John;;;\nFN:John Doe\nTEL;TYPE=CELL:+123456789\n' +
        'PHOTO;ENCODING=b;TYPE=JPEG:' +
        'A'.repeat(12000) +
        '\nEND:VCARD';
    const legitimateVCardMsg = createMockMsg({
        message: { contactMessage: { displayName: 'John Doe', vcard: normalVCardWithPhoto } }
    });
    const legVCardRes = inspectMessageForMalice(legitimateVCardMsg);
    assert.strictEqual(legVCardRes.isMalicious, false, 'VCard with photo should not be falsely flagged');
    console.log('✔ Normal VCards with embedded photo thumbnails are allowed');

    // [Test 6] Malformed oversized VCard body
    const maliciousVCard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Bomb\nNOTE:' + 'BOMB_PAYLOAD_'.repeat(1000) + '\nEND:VCARD';
    const badVCardMsg = createMockMsg({
        message: { contactMessage: { displayName: 'Bomb', vcard: maliciousVCard } }
    });
    const badVCardRes = inspectMessageForMalice(badVCardMsg);
    assert.strictEqual(badVCardRes.isMalicious, true, 'Oversized VCard body should be blocked');
    assert.strictEqual(badVCardRes.type, 'VCARD_CRASH');
    console.log('✔ Malicious oversized VCard bodies are blocked');

    // [Test 7] Mention explosion check
    const mentionTargets = Array.from({ length: 55 }, (_, i) => `62811111${i}@s.whatsapp.net`);
    const mentionMsg = createMockMsg({
        message: {
            extendedTextMessage: {
                text: 'Mention bomb',
                contextInfo: { mentionedJid: mentionTargets }
            }
        }
    });
    const nonAdminMentionRes = inspectMessageForMalice(mentionMsg, { isGroupAdmin: false, isOwner: false });
    assert.strictEqual(nonAdminMentionRes.isMalicious, true, 'Mention burst by non-admin should be flagged');
    assert.strictEqual(nonAdminMentionRes.type, 'STANZA_EXPLOSION');

    const adminMentionRes = inspectMessageForMalice(mentionMsg, { isGroupAdmin: true, isOwner: false });
    assert.strictEqual(adminMentionRes.isMalicious, false, 'Mention burst by admin should be allowed');
    console.log('✔ Privilege-aware mention explosion detection verified');

    // [Test 8] Kenon crash link trigger
    const kenonMsg = createMockMsg({ message: { conversation: 'Check wa.me/settings for status' } });
    const kenonRes = inspectMessageForMalice(kenonMsg);
    assert.strictEqual(kenonRes.isMalicious, true, 'Kenon crash link trigger should be intercepted');
    assert.strictEqual(kenonRes.type, 'KENON_PAYLOAD');
    console.log('✔ Kenon crash trigger signatures are blocked');

    // [Test 9] AntiSpam rate limiter
    antiSpamGuard.clear();
    const spammerJid = '999888111@s.whatsapp.net';
    for (let i = 0; i < 6; i++) {
        const res = antiSpamGuard.checkRate(spammerJid, false);
        assert.strictEqual(res.isSpam, false, `Message ${i + 1} should be permitted`);
    }
    const burstViolation = antiSpamGuard.checkRate(spammerJid, false);
    assert.strictEqual(burstViolation.isSpam, true, 'Burst flood exceeding 6 msgs in 3s must be flagged');
    console.log('✔ AntiSpamGuard burst flood interception verified');

    // [Test 10] In-memory blacklist cache
    securityEnforcementService.recordInMemory('bad_actor_99@s.whatsapp.net', 'BLOCKED', 'Spam flood');
    assert.strictEqual(securityEnforcementService.isBlacklisted('bad_actor_99@s.whatsapp.net'), true);
    assert.strictEqual(securityEnforcementService.isBlacklisted('safe_user_99@s.whatsapp.net'), false);
    console.log('✔ In-memory blacklist cache operations verified');

    console.log('--- ALL AUTOMATED SECURITY DEFENSE SYSTEM TESTS COMPLETED SUCCESSFULLY! ---');
}

runTests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
