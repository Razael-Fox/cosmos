import assert from 'assert';
import { SaraPromptContextResolver } from '../src/services/agent/prompts/contextResolver.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test_groq_api_key';
process.env.OWNER_PHONE_NUMBER = '6281200000101';

const GROUP_JID = '120363077777777777@g.us';
const BOT_JID = '6289999999999@s.whatsapp.net';
const ADMIN_LID = '49890910535790@lid';
const ADMIN_PHONE = '6282225907841@s.whatsapp.net';
const MEMBER_PHONE = '6283333333333@s.whatsapp.net';

function createSock(participants: any[]): any {
    return {
        user: { id: BOT_JID },
        groupMetadata: async () => ({ subject: 'Test Group', participants }),
        groupFetchAllParticipating: async () => ({})
    };
}

function createMsg(participant: string, participantAlt?: string): any {
    return {
        key: {
            remoteJid: GROUP_JID,
            participant,
            ...(participantAlt ? { participantAlt } : {}),
            fromMe: false
        },
        pushName: 'Razael',
        message: {}
    };
}

async function runTests() {
    console.log('--- STARTING SARA LID ADMIN RESOLUTION TESTS ---');

    // [Test 1] LID-masked admin resolves via participantAlt (production case:
    // participant 49890910535790@lid + participantAlt phone, member keyed by lid)
    console.log('[Test 1] Testing LID-masked admin resolution...');
    {
        const sock = createSock([
            { id: BOT_JID },
            { id: ADMIN_LID, lid: ADMIN_LID, admin: 'admin' },
            { id: MEMBER_PHONE }
        ]);
        const ctx = await SaraPromptContextResolver.resolveContext(
            sock,
            createMsg(ADMIN_LID, ADMIN_PHONE),
            GROUP_JID,
            'en'
        );
        assert.strictEqual(ctx.callerJid, ADMIN_PHONE, 'Caller JID must resolve via participantAlt');
        assert.strictEqual(ctx.isGroupAdmin, true, 'LID-masked admin must be recognized');
    }
    console.log('✓ LID-masked admin resolution verified.');

    // [Test 2] Phone-keyed member with separate lid field
    console.log('[Test 2] Testing phone-keyed member with lid field...');
    {
        const sock = createSock([{ id: BOT_JID }, { id: ADMIN_PHONE, lid: ADMIN_LID, admin: 'superadmin' }]);
        const ctx = await SaraPromptContextResolver.resolveContext(
            sock,
            createMsg(ADMIN_LID, ADMIN_PHONE),
            GROUP_JID,
            'en'
        );
        assert.strictEqual(ctx.isGroupAdmin, true, 'Group creator via lid cross-match must be recognized');
    }
    console.log('✓ Phone-keyed member resolution verified.');

    // [Test 3] Non-admin stays non-admin (no blanket-true regression)
    console.log('[Test 3] Testing non-admin denial...');
    {
        const sock = createSock([
            { id: BOT_JID },
            { id: ADMIN_PHONE, lid: ADMIN_LID, admin: 'admin' },
            { id: MEMBER_PHONE, lid: '1111222233334444@lid' }
        ]);
        const ctx = await SaraPromptContextResolver.resolveContext(
            sock,
            createMsg('1111222233334444@lid', MEMBER_PHONE),
            GROUP_JID,
            'en'
        );
        assert.strictEqual(ctx.isGroupAdmin, false, 'Regular member must not be admin');
    }
    console.log('✓ Non-admin denial verified.');

    console.log('--- ALL SARA LID ADMIN TESTS PASSED ---');
}

runTests().catch((err) => {
    console.error('SARA LID ADMIN TESTS FAILED:', err);
    process.exit(1);
});
