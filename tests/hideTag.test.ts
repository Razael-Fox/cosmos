import assert from 'assert';
import {
    definition,
    execute,
    fetchUrlText,
    hideTagDeps,
    isPublicIpLiteral,
    nodeHttpGet,
    publicLookup,
    MAX_HIDETAG_BYTES,
    MAX_HIDETAG_CHARS,
    type HttpGetter
} from '../src/commands/group/hideTag.js';
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
    callerAlt?: string;
    participants?: any[];
    message?: any;
    argsStr?: string;
    metadataCalls?: { count: number };
}): { ctx: any; sent: SentMessage[] } {
    const sent: SentMessage[] = [];
    const ctx = {
        sock: {
            user: { id: BOT_JID },
            groupMetadata: async () => {
                if (options.metadataCalls) options.metadataCalls.count++;
                return { participants: options.participants ?? [] };
            },
            sendMessage: async (jid: string, content: { text: string; mentions?: string[] }, opts?: any) => {
                sent.push({ jid, text: content.text, mentions: content.mentions, quoted: Boolean(opts?.quoted) });
                return { key: {} };
            }
        },
        msg: {
            key: {
                remoteJid: options.jid ?? GROUP_JID,
                participant: options.caller ?? ADMIN_JID,
                ...(options.callerAlt ? { participantAlt: options.callerAlt } : {})
            },
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
        assert.ok(sent[0].text.includes('\u200B'), 'Invisible padding must be appended');
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

    // [Test 8] URL fetch: SSRF block (no request leaves the host), streaming
    // Pinned transport, streaming cap, content-type gate, and redirect
    // revalidation — all with generic, digit-free failure strings.
    console.log('[Test 8] Testing URL fetch SSRF boundary...');
    const allowPublic = async () => true;
    const textHeaders = (extra: Record<string, string> = {}) =>
        new Headers({ 'content-type': 'text/plain', ...extra });
    const fakeGet =
        (handler: (url: string) => { status: number; headers: Headers; chunks: string[] }): HttpGetter =>
        (async (url: string) => {
            const res = handler(url);
            return {
                status: res.status,
                headers: res.headers,
                body: (async function* () {
                    for (const chunk of res.chunks) yield Buffer.from(chunk);
                })(),
                cancel: () => {}
            };
        }) as HttpGetter;
    // 8a. Blocked target: transport must never be called.
    let getCalls = 0;
    const countingGet: HttpGetter = async () => {
        getCalls++;
        throw new Error('must not be called');
    };
    const blocked = await fetchUrlText('http://169.254.169.254/latest/meta-data/', undefined, countingGet);
    assert.ok(!blocked.ok && (blocked as any).reason === 'BLOCKED');
    assert.strictEqual(getCalls, 0, 'No request may leave the host for link-local IPs');
    const { ctx } = createCtx({ participants: adminParticipants(), argsStr: 'http://169.254.169.254/x' });
    const blockedResult = await execute({}, ctx);
    assert.strictEqual(blockedResult, getTranslator('en')('tools.tag_hide.fetch_failed'));

    // 8b. Streaming cap enforced while reading (no Content-Length hint).
    const big = await fetchUrlText(
        'https://example.com/big.txt',
        allowPublic,
        fakeGet(() => ({ status: 200, headers: textHeaders(), chunks: ['x'.repeat(MAX_HIDETAG_BYTES + 1)] }))
    );
    assert.ok(!big.ok && (big as any).reason === 'TOO_LARGE');

    // 8c. Non-text content rejected before buffering.
    const pdf = await fetchUrlText(
        'https://example.com/f.pdf',
        allowPublic,
        fakeGet(() => ({ status: 200, headers: new Headers({ 'content-type': 'application/pdf' }), chunks: ['%PDF'] }))
    );
    assert.ok(!pdf.ok && (pdf as any).reason === 'UNSUPPORTED_TYPE');

    // 8d. Redirect targets revalidated per hop.
    const seen: string[] = [];
    const redirect = await fetchUrlText(
        'https://example.com/r',
        async (raw) => {
            seen.push(raw);
            return !raw.includes('169.254.169.254');
        },
        fakeGet(() => ({
            status: 302,
            headers: new Headers({ location: 'http://169.254.169.254/evil' }),
            chunks: []
        }))
    );
    assert.deepStrictEqual(seen, ['https://example.com/r', 'http://169.254.169.254/evil']);
    assert.ok(!redirect.ok && (redirect as any).reason === 'BLOCKED');

    // 8e. Happy path still delivers text.
    const good = await fetchUrlText(
        'https://example.com/note.txt',
        allowPublic,
        fakeGet(() => ({ status: 200, headers: textHeaders(), chunks: ['linked ', 'hello'] }))
    );
    assert.ok(good.ok && (good as any).text === 'linked hello');

    // 8f. Transport failure maps to the generic string (no dial internals).
    const down = await fetchUrlText(
        'https://example.com/down.txt',
        allowPublic,
        fakeGet(() => {
            throw new Error('connect ECONNREFUSED 127.0.0.1:9');
        })
    );
    assert.ok(!down.ok && (down as any).reason === 'NETWORK');

    // 8g. Pinned transport blocks loopback even with the pre-check bypassed —
    // a listening local server must receive zero requests. IP literals never
    // reach the lookup hook, so the transport validates them up front.
    {
        const http = await import('node:http');
        let hits = 0;
        const server = http.createServer((_req, res) => {
            hits++;
            res.end('nope');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            const port = (server.address() as any).port;
            const pinned = await fetchUrlText(`http://127.0.0.1:${port}/secret`, allowPublic, nodeHttpGet);
            assert.ok(!pinned.ok, 'Loopback must never connect');
            assert.strictEqual(hits, 0, 'Pinned transport must not emit any request to loopback');
        } finally {
            server.close();
        }
    }

    // 8h. The lookup hook itself rejects non-public resolutions.
    {
        const loopback = await new Promise<{ err: Error | null }>((resolve) =>
            publicLookup('127.0.0.1', {}, (err) => resolve({ err }))
        );
        assert.ok(loopback.err instanceof Error, 'Loopback resolution must be rejected');
        const unresolvable = await new Promise<{ err: Error | null }>((resolve) =>
            publicLookup('nonexistent-invalid-test.local', {}, (err) => resolve({ err }))
        );
        assert.ok(unresolvable.err instanceof Error, 'Unresolvable hosts must be rejected');
    }

    // 8i. Bracketed + hex-mapped IPv6 literals are judged, not trusted.
    {
        assert.strictEqual(isPublicIpLiteral('[::1]'), false);
        assert.strictEqual(isPublicIpLiteral('[::ffff:127.0.0.1]'), false);
        assert.strictEqual(isPublicIpLiteral('[::ffff:7f00:1]'), false);
        assert.strictEqual(isPublicIpLiteral('[fe80::1]'), false);
        assert.strictEqual(isPublicIpLiteral('::ffff:7f00:1'), false, 'Unbracketed hex-mapped must also be caught');
        assert.strictEqual(isPublicIpLiteral('[2606:4700:4700::1111]'), true, 'Public IPv6 stays allowed');
        assert.strictEqual(isPublicIpLiteral('2606:4700:4700::1111'), true);
        for (const target of [
            'http://[::1]/x',
            'http://[::ffff:127.0.0.1]/x',
            'http://[::ffff:7f00:1]/x',
            'http://[fe80::1]/x'
        ]) {
            let calls = 0;
            const out = await fetchUrlText(
                target,
                undefined,
                (async () => {
                    calls++;
                    throw new Error('must not be called');
                }) as HttpGetter
            );
            assert.ok(!out.ok, `${target} must be blocked`);
            assert.strictEqual(calls, 0, `No request for ${target}`);
        }
    }

    // 8j. IPv6-loopback listener variant: zero requests even pre-check-bypassed.
    {
        const http = await import('node:http');
        let hits = 0;
        const server = http.createServer((_req, res) => {
            hits++;
            res.end('nope');
        });
        try {
            await new Promise<void>((resolve, reject) => {
                server.on('error', reject);
                server.listen(0, '::1', resolve);
            });
            const port = (server.address() as any).port;
            const pinned = await fetchUrlText(`http://[::1]:${port}/secret`, allowPublic, nodeHttpGet);
            assert.ok(!pinned.ok, 'IPv6 loopback must never connect');
            assert.strictEqual(hits, 0, 'No request to IPv6 loopback');
        } catch (err) {
            if ((err as any)?.code === 'EAFNOSUPPORT') {
                console.log('    (skipped: no IPv6 loopback in this environment)');
            } else {
                throw err;
            }
        } finally {
            server.close();
        }
    }
    console.log('✓ URL fetch SSRF boundary verified.');

    // [Test 10] Attached document owns the body slot: stubbed download via
    // the hideTagDeps seam (empty file -> `empty`, never the quoted reply).
    console.log('[Test 10] Testing attached-document body ownership...');
    const realDownload = hideTagDeps.downloadDocument;
    try {
        hideTagDeps.downloadDocument = (async function* () {
            yield Buffer.from('');
        } as unknown) as typeof realDownload;
        const { ctx } = createCtx({
            participants: adminParticipants(),
            message: {
                documentMessage: { fileName: 'notes.txt', fileLength: 10 },
                extendedTextMessage: { contextInfo: { quotedMessage: { conversation: 'must not leak' } } }
            }
        });
        const emptyResult = await execute({}, ctx);
        assert.strictEqual(emptyResult, getTranslator('en')('tools.tag_hide.empty'));

        hideTagDeps.downloadDocument = (async function* () {
            yield Buffer.from('doc ');
            yield Buffer.from('body text');
        } as unknown) as typeof realDownload;
        const { ctx: docCtx, sent: docSent } = createCtx({
            participants: adminParticipants(),
            message: { documentMessage: { fileName: 'notes.md', fileLength: 16 } }
        });
        const docResult = await execute({}, docCtx);
        assert.strictEqual(docResult, undefined);
        assert.ok(docSent[0].text.startsWith('doc body text'));
    } finally {
        hideTagDeps.downloadDocument = realDownload;
    }
    console.log('✓ Attached-document body ownership verified.');

    // [Test 11] Direct-text body cap + LID alt-identifier admin + single-snapshot mentions.
    console.log('[Test 11] Testing body cap, alt-identifier admin, and mention fan-out...');
    {
        const { ctx } = createCtx({
            participants: adminParticipants(),
            argsStr: 'x'.repeat(MAX_HIDETAG_CHARS + 1)
        });
        const result = await execute({}, ctx);
        assert.strictEqual(result, getTranslator('en')('tools.tag_hide.too_long'));
    }
    {
        // Caller visible only via participantAlt (LID-masked sender).
        const { ctx, sent } = createCtx({
            caller: MEMBER_A,
            callerAlt: ADMIN_JID,
            participants: adminParticipants(),
            argsStr: 'alt hello'
        });
        const result = await execute({}, ctx);
        assert.strictEqual(result, undefined);
        assert.ok(sent[0].text.startsWith('alt hello'));
    }
    {
        // LID-only member resolved from the same snapshot: exactly 2 metadata
        // reads total (1 admin gate + 1 execute), no per-member refetch.
        const metadataCalls = { count: 0 };
        const LID_ONLY = '5555666677778888@lid';
        const { ctx, sent } = createCtx({
            participants: [
                { id: BOT_JID },
                { id: ADMIN_JID, admin: 'admin' },
                { id: MEMBER_A, lid: '1111222233334444@lid' },
                { id: LID_ONLY }
            ],
            argsStr: 'lid test',
            metadataCalls
        });
        const result = await execute({}, ctx);
        assert.strictEqual(result, undefined);
        assert.strictEqual(metadataCalls.count, 2, `Expected 2 metadata reads, got ${metadataCalls.count}`);
        const mentions = sent[0].mentions ?? [];
        assert.ok(mentions.includes(MEMBER_A), 'Phone member must be mentioned directly');
        assert.ok(mentions.includes(LID_ONLY), 'Unmapped LID member must fall back to its @lid mention');
        assert.ok(!mentions.includes(BOT_JID));
    }
    console.log('✓ Body cap, alt-identifier admin, and mention fan-out verified.');

    // [Test 9] Quota ceilings + locale labels (Rule H Formal English)
    console.log('[Test 9] Testing quota wiring...');
    assert.deepStrictEqual(TIER_LIMITS.FREE.featureLimits?.hidetag, { max: 3, windowMs: 600_000 });
    assert.deepStrictEqual(TIER_LIMITS.SUBSIDIZED.featureLimits?.hidetag, { max: 10, windowMs: 600_000 });
    assert.deepStrictEqual(TIER_LIMITS.PARTNER.featureLimits?.hidetag, { max: 25, windowMs: 600_000 });
    assert.notStrictEqual(getTranslator('en')('core.limits.features.hidetag'), 'core.limits.features.hidetag');
    assert.notStrictEqual(getTranslator('id')('core.limits.features.hidetag'), 'core.limits.features.hidetag');
    assert.notStrictEqual(getTranslator('en')('tools.commands.tag_hide.description'), 'tools.commands.tag_hide.description');
    assert.notStrictEqual(getTranslator('id')('tools.commands.tag_hide.description'), 'tools.commands.tag_hide.description');
    assert.notStrictEqual(getTranslator('en')('tools.tag_hide.too_long'), 'tools.tag_hide.too_long');
    assert.notStrictEqual(getTranslator('id')('tools.tag_hide.too_long'), 'tools.tag_hide.too_long');
    assert.notStrictEqual(getTranslator('en')('tools.tag_hide.url_unsupported_type'), 'tools.tag_hide.url_unsupported_type');
    assert.notStrictEqual(getTranslator('id')('tools.tag_hide.url_unsupported_type'), 'tools.tag_hide.url_unsupported_type');
    console.log('✓ Quota wiring verified.');

    console.log('--- ALL HIDETAG TESTS PASSED ---');
}

runTests().catch((err) => {
    console.error('HIDETAG TESTS FAILED:', err);
    process.exit(1);
});
