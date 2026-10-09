import assert from 'assert';
import { definition, execute, MAX_HIDETAG_BYTES } from '../src/commands/group/hideTag.js';
import { getTranslator } from '../src/lib/i18n.js';
import { normalizeCommandKey } from '../src/lib/commandNormalize.js';
import { TIER_LIMITS } from '../src/services/quotaService.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test_groq_api_key';

const GROUP_JID = '120363099999999999@g.us';
const BOT_JID = '6289999999999@s.whatsapp.net';
const ADMIN_JID = '6281111111111@s.whatsapp.net';
const MEMBER_A = '6282222222222@s.whatsapp.net';
const MEMBER_B = '6283333333333@s.whatsapp.net';

interface SentMessage {
    jid: string;
    text: string;
    mentions?: string[];
    quoted?: boolean;
}

function createCtx(options: {
    jid?: string;
    lang?: 'en' | 'id';
    caller?: string;
    participants?: any[];
    message?: any;
    argsStr?: string;
}): { ctx: any; sent: SentMessage[] } {
    const sent: SentMessage[] = [];
    const ctx = {
        sock: {
            user: { id: BOT_JID },
            groupMetadata: async () => ({ participants: options.participants ?? [] }),
            sendMessage: async (jid: string, content: { text: string; mentions?: string[] }, opts?: any) => {
                sent.push({ jid, text: content.text, mentions: content.mentions, quoted: Boolean(opts?.quoted) });
                return { key: {} };
            }
        },
        msg: {
            key: { remoteJid: options.jid ?? GROUP_JID, participant: options.caller ?? ADMIN_JID },
            message: options.message ?? {}
        },
        jid: options.jid ?? GROUP_JID,
        t: getTranslator(options.lang ?? 'en'),
        lang: options.lang ?? 'en',
        argsStr: options.argsStr ?? ''
    };
    return { ctx, sent };
}

function adminParticipants(extra: any[] = []): any[] {
    return [{ id: BOT_JID }, { id: ADMIN_JID, admin: 'admin' }, { id: MEMBER_A }, { id: MEMBER_B }, ...extra];
}

async function runTests() {
    console.log('--- STARTING HIDETAG COMMAND TESTS ---');

    // [Test 1] Definition contract (Rule AF spaced canonical + short aliases)
    console.log('[Test 1] Testing tool definition metadata...');
    assert.strictEqual(definition.name, 'tag hide');
    assert.strictEqual(definition.displayNames?.en, 'tag hide');
    assert.strictEqual(definition.displayNames?.id, 'tandai sembunyi');
    assert.strictEqual(definition.category, 'Group');
    assert.strictEqual(definition.descriptionKey, 'tools.commands.tag_hide.description');
    assert.strictEqual(definition.limitKey, 'hidetag');
    for (const alias of ['hidetag', 'ht', 'tag hide', 'tandai sembunyi']) {
        assert.ok(
            (definition.aliases ?? []).map((a) => normalizeCommandKey(a)).includes(normalizeCommandKey(alias)),
            `Alias "${alias}" must be registered`
        );
    }
    assert.strictEqual(normalizeCommandKey('. hidetag'), 'hidetag', 'Detached prefix must resolve');
    assert.strictEqual(normalizeCommandKey('.HT'), 'ht', 'Alias lookup must be case-insensitive');
    console.log('✓ Definition metadata verified.');

    // [Test 2] Group-only guard
    console.log('[Test 2] Testing group-only guard...');
    {
        const { ctx } = createCtx({ jid: '628123456789@s.whatsapp.net', lang: 'en' });
        const result = await execute({}, ctx);
        assert.ok(typeof result === 'string' && result.includes('GROUP-ONLY COMMAND'));
    }
    {
        const { ctx } = createCtx({ jid: '628123456789@s.whatsapp.net', lang: 'id' });
        const result = await execute({}, ctx);
        assert.ok(typeof result === 'string' && result.includes('PERINTAH KHUSUS GRUP'));
    }
    console.log('✓ Group-only guard verified.');

    // [Test 3] Admin gate (non-admin blocked)
    console.log('[Test 3] Testing admin gate...');
    {
        const { ctx } = createCtx({
            lang: 'en',
            caller: MEMBER_A,
            participants: adminParticipants(),
            argsStr: 'hello'
        });
        const result = await execute({}, ctx);
        assert.ok(typeof result === 'string' && result.includes('must be a group admin'));
    }
    console.log('✓ Admin gate verified.');

    // [Test 4] Bare command returns usage card
    console.log('[Test 4] Testing usage card...');
    {
        const { ctx } = createCtx({ lang: 'en', participants: adminParticipants() });
        const result = await execute({}, ctx);
        assert.ok(typeof result === 'string' && result.includes('HIDETAG USAGE'));
    }
    {
        const { ctx } = createCtx({ lang: 'id', participants: adminParticipants() });
        const result = await execute({}, ctx);
        assert.ok(typeof result === 'string' && result.includes('CARA PAKAI HIDETAG'));
    }
    console.log('✓ Usage card verified.');

    // [Test 5] Direct text: self-sent unquoted, invisible, bot excluded
    console.log('[Test 5] Testing direct-text announcement...');
    {
        const { ctx, sent } = createCtx({ lang: 'en', participants: adminParticipants(), argsStr: 'Meeting at 7 PM' });
        const result = await execute({}, ctx);
        assert.strictEqual(result, undefined, 'Success path must return void (no double-send)');
        assert.strictEqual(sent.length, 1);
        assert.ok(sent[0].text.startsWith('Meeting at 7 PM'), 'Body must stay verbatim');
        assert.ok(sent[0].text.includes('​'), 'Invisible padding must be appended');
        assert.ok(!sent[0].text.includes('@'), 'No visible @-list may leak into the body');
        assert.strictEqual(sent[0].quoted, false, 'Announcement must be unquoted');
        const mentions = sent[0].mentions ?? [];
        assert.ok(mentions.includes(ADMIN_JID), 'Admin member must be tagged');
        assert.ok(mentions.includes(MEMBER_A) && mentions.includes(MEMBER_B), 'Members must be tagged');
        assert.ok(!mentions.includes(BOT_JID), 'Bot JID must be excluded');
    }
    console.log('✓ Direct-text announcement verified.');

    // [Test 6] Reply context becomes the body; explicit args win
    console.log('[Test 6] Testing reply-context priority...');
    {
        const { ctx, sent } = createCtx({
            participants: adminParticipants(),
            message: { extendedTextMessage: { text: '.ht', contextInfo: { quotedMessage: { conversation: 'quoted hello' } } } }
        });
        const result = await execute({}, ctx);
        assert.strictEqual(result, undefined);
        assert.ok(sent[0].text.startsWith('quoted hello'));
    }
    {
        const { ctx, sent } = createCtx({
            participants: adminParticipants(),
            argsStr: 'explicit wins',
            message: { extendedTextMessage: { text: '.ht', contextInfo: { quotedMessage: { conversation: 'quoted hello' } } } }
        });
        await execute({}, ctx);
        assert.ok(sent[0].text.startsWith('explicit wins'), 'Explicit args must win over the quote');
    }
    console.log('✓ Reply-context priority verified.');

    // [Test 7] Document guards (no download needed for rejections)
    console.log('[Test 7] Testing document guards...');
    {
        const { ctx } = createCtx({
            participants: adminParticipants(),
            message: { documentMessage: { fileName: 'notes.pdf', fileLength: 100 } }
        });
        const result = await execute({}, ctx);
        assert.ok(typeof result === 'string' && result.includes('Only .txt and .md'));
    }
    {
        const { ctx } = createCtx({
            participants: adminParticipants(),
            message: { documentMessage: { fileName: 'notes.txt', fileLength: MAX_HIDETAG_BYTES + 1 } }
        });
        const result = await execute({}, ctx);
        assert.ok(typeof result === 'string' && result.includes('100 KB'));
    }
    console.log('✓ Document guards verified.');

    // [Test 8] URL fetch failure paths (fetch stubbed, no network)
    console.log('[Test 8] Testing URL fetch paths...');
    const realFetch = globalThis.fetch;
    try {
        globalThis.fetch = (async () => {
            throw new Error('network down');
        }) as any;
        const { ctx } = createCtx({ participants: adminParticipants(), argsStr: 'https://example.com/note.txt' });
        const result = await execute({}, ctx);
        assert.ok(typeof result === 'string' && result.includes('Failed to fetch'), `Got: ${result}`);
    } finally {
        globalThis.fetch = realFetch;
    }
    try {
        globalThis.fetch = (async () =>
            ({ ok: true, headers: { get: () => String(MAX_HIDETAG_BYTES + 1) }, arrayBuffer: async () => new ArrayBuffer(0) }) as any) as any;
        const { ctx } = createCtx({ participants: adminParticipants(), argsStr: 'https://example.com/big.txt' });
        const result = await execute({}, ctx);
        assert.ok(typeof result === 'string' && result.includes('exceeds the 100 KB'), `Got: ${result}`);
    } finally {
        globalThis.fetch = realFetch;
    }
    console.log('✓ URL fetch paths verified.');

    // [Test 9] Quota ceilings + locale labels (Rule H Formal English)
    console.log('[Test 9] Testing quota wiring...');
    assert.deepStrictEqual(TIER_LIMITS.FREE.featureLimits?.hidetag, { max: 3, windowMs: 600_000 });
    assert.deepStrictEqual(TIER_LIMITS.SUBSIDIZED.featureLimits?.hidetag, { max: 10, windowMs: 600_000 });
    assert.deepStrictEqual(TIER_LIMITS.PARTNER.featureLimits?.hidetag, { max: 25, windowMs: 600_000 });
    assert.notStrictEqual(getTranslator('en')('core.limits.features.hidetag'), 'core.limits.features.hidetag');
    assert.notStrictEqual(getTranslator('id')('core.limits.features.hidetag'), 'core.limits.features.hidetag');
    assert.notStrictEqual(getTranslator('en')('tools.commands.tag_hide.description'), 'tools.commands.tag_hide.description');
    assert.notStrictEqual(getTranslator('id')('tools.commands.tag_hide.description'), 'tools.commands.tag_hide.description');
    console.log('✓ Quota wiring verified.');

    console.log('--- ALL HIDETAG TESTS PASSED ---');
}

runTests().catch((err) => {
    console.error('HIDETAG TESTS FAILED:', err);
    process.exit(1);
});
