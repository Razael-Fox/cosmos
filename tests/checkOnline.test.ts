import assert from 'assert';
import { definition, execute } from '../src/commands/group/checkOnline.js';
import { getTranslator } from '../src/lib/i18n.js';
import { getAllOnlineIds, updateUserPresence } from '../src/services/presenceService.js';
import menuService, { CATEGORY_ICONS, CATEGORY_SLUGS, CANONICAL_CATEGORY_ORDER } from '../src/services/menuService.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test_groq_api_key';

interface SentMessage {
    jid: string;
    text: string;
    mentions?: string[];
}

function createCtx(options: {
    jid: string;
    lang: 'en' | 'id';
    participants?: Array<{ id?: string; lid?: string }>;
    botId?: string;
    botLid?: string;
    failMetadata?: boolean;
}): { ctx: any; sent: SentMessage[]; subscribed: string[] } {
    const sent: SentMessage[] = [];
    const subscribed: string[] = [];
    const ctx = {
        sock: {
            user: { id: options.botId, lid: options.botLid },
            groupMetadata: async () => {
                if (options.failMetadata) throw new Error('metadata unavailable');
                return { participants: options.participants ?? [] };
            },
            presenceSubscribe: async (target: string) => {
                subscribed.push(target);
            },
            sendMessage: async (jid: string, content: { text: string; mentions?: string[] }) => {
                sent.push({ jid, text: content.text, mentions: content.mentions });
                return { key: {} };
            }
        },
        msg: {
            key: { remoteJid: options.jid, participant: '6287777777777@s.whatsapp.net' },
            message: {}
        },
        jid: options.jid,
        t: getTranslator(options.lang),
        lang: options.lang
    };
    return { ctx, sent, subscribed };
}

async function runTests() {
    console.log('--- STARTING CHECK ONLINE COMMAND TESTS ---');

    // [Test 1] Definition contract
    console.log('[Test 1] Testing tool definition metadata...');
    assert.strictEqual(definition.name, 'check online', 'Command name must be the spaced "check online"');
    assert.strictEqual(definition.displayNames?.en, 'check online');
    assert.strictEqual(definition.displayNames?.id, 'cek online');
    assert.strictEqual(definition.descriptionKey, 'tools.commands.check_online.description');
    assert.ok(definition.aliases?.includes('cek online'), 'Indonesian alias must be registered');
    for (const alias of definition.aliases ?? []) {
        assert.ok(alias.includes(' '), `Alias "${alias}" must be multi-token per Aturan AF`);
    }
    assert.ok(
        definition.aliases?.every((a) => ['check online', 'cek online', '.check online', '.cek online'].includes(a)),
        'Alias set must stay canonical and multi-token'
    );
    console.log('✓ Definition metadata verified.');

    // [Test 2] Category is registered in the menu system
    console.log('[Test 2] Testing Group category registration...');
    assert.ok(CANONICAL_CATEGORY_ORDER.includes(definition.category!), 'Category must be in canonical order');
    assert.ok(CATEGORY_ICONS[definition.category!], 'Category must have an icon');
    assert.ok(CATEGORY_SLUGS[definition.category!], 'Category must have a slug');
    assert.strictEqual(menuService.normalizeCategory('group'), definition.category);
    assert.strictEqual(menuService.getCategoryIcon(definition.category!), CATEGORY_ICONS[definition.category!]);
    const tId = getTranslator('id');
    const tEn = getTranslator('en');
    assert.notStrictEqual(tId('tools.menu.categories.group'), 'tools.menu.categories.group', 'id label must exist');
    assert.notStrictEqual(tEn('tools.menu.categories.group'), 'tools.menu.categories.group', 'en label must exist');
    console.log('✓ Group category registered in menuService and both locales.');

    // [Test 3] Direct messages are rejected
    console.log('[Test 3] Testing group-only guard...');
    {
        const { ctx, sent } = createCtx({ jid: '628123456789@s.whatsapp.net', lang: 'en' });
        await execute({}, ctx);
        assert.strictEqual(sent.length, 1, 'DM must receive exactly one reply');
        assert.ok(sent[0].text.includes('GROUP-ONLY COMMAND'), 'DM reply must be the group-only notice');
    }
    {
        const { ctx, sent } = createCtx({ jid: '628123456789@s.whatsapp.net', lang: 'id' });
        await execute({}, ctx);
        assert.ok(sent[0].text.includes('PERINTAH KHUSUS GRUP'), 'Indonesian DM reply must be localized');
    }
    console.log('✓ Group-only guard verified.');

    // [Test 4] Presence enumeration
    console.log('[Test 4] Testing getAllOnlineIds...');
    await updateUserPresence('628555000111@s.whatsapp.net', 'online');
    await updateUserPresence('628555000222@s.whatsapp.net', 'offline');
    const onlineIds = getAllOnlineIds();
    assert.ok(onlineIds.includes('628555000111'), 'Online phone ID must be enumerated');
    assert.ok(!onlineIds.includes('628555000222'), 'Offline ID must not be enumerated');
    console.log('✓ getAllOnlineIds verified.');

    // [Test 5] Online members are listed with green mentions, bot excluded
    console.log('[Test 5] Testing success card rendering...');
    {
        const { ctx, sent } = createCtx({
            jid: '120363000000000000@g.us',
            lang: 'en',
            botId: '6289999999999@s.whatsapp.net',
            botLid: '199999999999999@lid',
            participants: [
                { id: '6289999999999@s.whatsapp.net', lid: '199999999999999@lid' },
                { id: '628555000111@s.whatsapp.net' },
                { id: '628555000222@s.whatsapp.net' }
            ]
        });
        await execute({}, ctx);
        assert.strictEqual(sent.length, 1);
        const text = sent[0].text;
        assert.ok(text.includes('ONLINE MEMBERS'), 'Title must be rendered');
        assert.ok(text.includes('1. *@628555000111*'), 'Online member must be listed with mention');
        assert.ok(!text.includes('6289999999999'), 'Bot JID must be excluded');
        assert.ok(!text.includes('628555000222'), 'Offline member must not be listed');
        assert.deepStrictEqual(sent[0].mentions, ['628555000111@s.whatsapp.net'], 'Mentions array must be parallel');
        assert.ok(!/\n>\s*\n/.test(text), 'Zero-empty-quote invariant must hold');
        assert.ok(!/[╭│╰┌└─━┃]/.test(text), 'No box-drawing characters allowed');
    }
    console.log('✓ Success card verified.');

    // [Test 6] No one online -> empty state
    console.log('[Test 6] Testing empty-state card...');
    {
        const { ctx, sent } = createCtx({
            jid: '120363000000000001@g.us',
            lang: 'id',
            participants: [{ id: '628555000222@s.whatsapp.net' }]
        });
        await execute({}, ctx);
        assert.ok(sent[0].text.includes('TIDAK ADA ANGGOTA YANG ONLINE'), 'Indonesian empty state must be localized');
        assert.ok(!/\n>\s*\n/.test(sent[0].text), 'Zero-empty-quote invariant must hold');
    }
    console.log('✓ Empty-state card verified.');

    // [Test 7] Metadata failure returns a dedicated error and does not consume the cooldown
    console.log('[Test 7] Testing metadata failure handling...');
    {
        const { ctx, sent } = createCtx({ jid: '120363000000000002@g.us', lang: 'en', failMetadata: true });
        await execute({}, ctx);
        assert.ok(sent[0].text.includes('PRESENCE CHECK FAILED'), 'Dedicated error message expected');
        assert.ok(!sent[0].text.includes('No tracked group members'), 'Must not reuse the empty-state body');

        // A subsequent successful call in the same group must not be blocked.
        const retry = createCtx({
            jid: '120363000000000002@g.us',
            lang: 'en',
            participants: [{ id: '628555000111@s.whatsapp.net' }]
        });
        await execute({}, retry.ctx);
        assert.ok(retry.sent[0].text.includes('ONLINE MEMBERS'), 'Cooldown must not be consumed on failure');
    }
    console.log('✓ Metadata failure handling verified.');

    // [Test 8] Per-sender cooldown
    console.log('[Test 8] Testing per-sender cooldown...');
    {
        const base = {
            participants: [{ id: '628555000111@s.whatsapp.net' }],
            lang: 'en' as const
        };
        const first = createCtx({ ...base, jid: '120363000000000003@g.us' });
        await execute({}, first.ctx);
        const second = createCtx({ ...base, jid: '120363000000000003@g.us' });
        await execute({}, second.ctx);
        assert.ok(second.sent[0].text.includes('Please wait'), 'Second call must hit the cooldown');

        // A different sender in the same group must not be blocked.
        const otherCtx = createCtx({ ...base, jid: '120363000000000003@g.us' });
        otherCtx.ctx.msg.key.participant = '6286666666666@s.whatsapp.net';
        await execute({}, otherCtx.ctx);
        assert.ok(otherCtx.sent[0].text.includes('ONLINE MEMBERS'), 'Other senders must not be locked out');
    }
    console.log('✓ Per-sender cooldown verified.');

    // [Test 9] First invocation subscribes phone JIDs once; second does not resubscribe
    console.log('[Test 9] Testing one-time presence subscription...');
    {
        const jid = '120363000000000009@g.us';
        const first = createCtx({
            jid,
            lang: 'en',
            participants: [
                { id: '628555000111@s.whatsapp.net', lid: '111111111111111@lid' },
                { id: '628555000333@s.whatsapp.net' }
            ]
        });
        await execute({}, first.ctx);
        await new Promise((r) => setImmediate(r));
        assert.deepStrictEqual(
            [...first.subscribed].sort(),
            ['628555000111@s.whatsapp.net', '628555000333@s.whatsapp.net'],
            'Only @s.whatsapp.net JIDs must be subscribed'
        );

        const second = createCtx({
            jid,
            lang: 'en',
            participants: [{ id: '628555000111@s.whatsapp.net' }]
        });
        second.ctx.msg.key.participant = '6286666666666@s.whatsapp.net';
        await execute({}, second.ctx);
        await new Promise((r) => setImmediate(r));
        assert.strictEqual(second.subscribed.length, 0, 'Subscribed group must not resubscribe');
    }
    console.log('✓ One-time presence subscription verified.');

    console.log('--- ALL CHECK ONLINE TESTS PASSED ---');
}

runTests().catch((err) => {
    console.error('CHECK ONLINE TESTS FAILED:', err);
    process.exit(1);
});
