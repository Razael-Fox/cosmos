import assert from 'assert';
import { definition, execute, extractChannelInvite, findNewsletterRef } from '../src/tools/check_chid.js';
import { getTranslator } from '../src/utils/i18n.js';
import { cacheMessage } from '../src/utils/messageCache.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test_groq_api_key';

const CODE = '0029VaAbCdEf12345';
const NL = '120363312345678901@newsletter';
// Baileys returns the raw WMex result: details live under thread_metadata.
const NESTED_META = {
    id: NL,
    thread_metadata: {
        name: { text: 'Cosmos Updates' },
        subscribers_count: 12345,
        verification: 'VERIFIED',
        invite: CODE,
        creation_time: '1773446400'
    }
};

const META = {
    id: NL,
    name: 'Cosmos Updates',
    subscribers: 12345,
    verification: 'VERIFIED',
    invite: CODE,
    creation_time: 1773446400
};

let n = 0;
function run(opts: {
    argsStr?: string;
    quoted?: any;
    stanzaId?: string;
    lang?: 'en' | 'id';
    meta?: any;
    jidMeta?: 'fail' | 'null';
    inviteThrows?: boolean;
}) {
    const sent: string[] = [];
    const calls: string[][] = [];
    const sender = `62811${String(++n).padStart(7, '0')}@s.whatsapp.net`;
    const lang = opts.lang ?? 'en';
    const ctx: any = {
        sock: {
            user: { id: '6280000000000@s.whatsapp.net' },
            newsletterMetadata: async (type: string, key: string) => {
                calls.push([type, key]);
                if (opts.inviteThrows) throw new Error('offline');
                if (type === 'jid') {
                    if (opts.jidMeta === 'fail') throw new Error('nope');
                    if (opts.jidMeta === 'null') return null;
                }
                return opts.meta === undefined ? META : opts.meta;
            },
            sendMessage: async (_j: string, c: { text: string }) => void sent.push(c.text)
        },
        msg: {
            key: { remoteJid: 'x@g.us', participant: sender, id: `M${n}` },
            message: opts.quoted
                ? {
                      extendedTextMessage: {
                          text: '.check chid',
                          contextInfo: { stanzaId: opts.stanzaId, quotedMessage: opts.quoted }
                      }
                  }
                : {}
        },
        jid: 'x@g.us',
        argsStr: opts.argsStr ?? '',
        t: getTranslator(lang),
        lang
    };
    return { ctx, sent, calls };
}

async function main() {
    // definition
    assert.strictEqual(definition.name, 'check chid');
    assert.strictEqual(definition.descriptionKey, 'tools.commands.check_chid.description');
    assert.ok(definition.aliases!.every((a) => a.includes(' ')));

    // pure helpers
    assert.strictEqual(extractChannelInvite(`see https://whatsapp.com/channel/${CODE}!`), CODE);
    assert.strictEqual(extractChannelInvite('https://example.com'), undefined);
    assert.strictEqual(extractChannelInvite(`https://evilwhatsapp.com/channel/${CODE}`), undefined);
    assert.strictEqual(extractChannelInvite(`https://evil-whatsapp.com/channel/${CODE}`), undefined);
    assert.ok(extractChannelInvite(`join https://whatsapp.com/channel/${CODE} now`));
    assert.deepStrictEqual(findNewsletterRef({ conversation: `whatsapp.com/channel/${CODE}` }), { code: CODE });
    const fwd = { forwardedNewsletterMessageInfo: { newsletterJid: NL, newsletterName: 'N', serverMessageId: 7 } };
    assert.strictEqual(
        findNewsletterRef({ extendedTextMessage: { text: `whatsapp.com/channel/${CODE}`, contextInfo: fwd } })?.jid,
        NL,
        'forward info beats link text'
    );
    assert.strictEqual(
        findNewsletterRef({
            viewOnceMessage: { message: { imageMessage: { caption: `whatsapp.com/channel/${CODE}` } } }
        })?.code,
        CODE
    );

    // URL arg + card contents
    let r = run({ argsStr: `https://whatsapp.com/channel/${CODE}` });
    await execute({}, r.ctx);
    assert.deepStrictEqual(r.calls, [['invite', CODE]]);
    const card = r.sent[0];
    assert.ok(card.includes('```' + NL + '```') && card.includes('Resolved from invite link'));
    assert.ok(card.includes('12,345') && card.includes('2026-03-14') && card.includes('Cosmos Updates'));
    assert.ok(!/undefined|^>\s*$/m.test(card));

    // backticked URL
    r = run({ argsStr: '`https://whatsapp.com/channel/' + CODE + '`' });
    await execute({}, r.ctx);
    assert.deepStrictEqual(r.calls, [['invite', CODE]]);

    // nested thread_metadata payload (production shape) renders like the flat one
    r = run({ argsStr: `whatsapp.com/channel/${CODE}`, meta: NESTED_META });
    await execute({}, r.ctx);
    const nested = r.sent[0];
    assert.ok(
        nested.includes('Cosmos Updates') &&
            nested.includes('12,345') &&
            nested.includes('Verified') &&
            nested.includes('2026-03-14') &&
            nested.includes(CODE),
        `nested metadata must render, got: ${nested}`
    );

    // optional fields omitted
    r = run({ argsStr: `whatsapp.com/channel/${CODE}`, meta: { id: NL, name: 'Bare' } });
    await execute({}, r.ctx);
    assert.ok(!/Followers|Verified|Created|Invite|undefined/.test(r.sent[0]));

    // id locale differs
    r = run({ argsStr: `whatsapp.com/channel/${CODE}`, lang: 'id' });
    await execute({}, r.ctx);
    assert.ok(r.sent[0].includes('ID SALURAN') && r.sent[0].includes('12.345') && r.sent[0].includes('Ya'));

    // URL in quoted text
    r = run({ quoted: { conversation: `join https://whatsapp.com/channel/${CODE}` } });
    await execute({}, r.ctx);
    assert.deepStrictEqual(r.calls, [['invite', CODE]]);
    assert.ok(r.sent[0].includes('replied message link'));

    // forwarded from channel (enriched)
    r = run({ quoted: { extendedTextMessage: { text: 'hi', contextInfo: fwd } } });
    await execute({}, r.ctx);
    assert.deepStrictEqual(r.calls, [['jid', NL]]);
    assert.ok(r.sent[0].includes(NL) && r.sent[0].includes('forwarded message') && r.sent[0].includes('12,345'));

    // forwarded with nested metadata
    r = run({ quoted: { extendedTextMessage: { text: 'hi', contextInfo: fwd } }, meta: NESTED_META });
    await execute({}, r.ctx);
    assert.ok(
        r.sent[0].includes('12,345') && r.sent[0].includes('Cosmos Updates') && !r.sent[0].includes('Message ID')
    );

    // forwarded, enrichment fails -> still answers with ID, name, message id
    for (const jidMeta of ['fail', 'null'] as const) {
        r = run({ quoted: { extendedTextMessage: { text: 'hi', contextInfo: fwd } }, jidMeta });
        await execute({}, r.ctx);
        assert.ok(r.sent[0].includes(NL) && r.sent[0].includes('Message ID') && r.sent[0].includes('N'));
        assert.ok(!r.sent[0].includes('Followers'));
    }

    // cache hit restores stripped contextInfo
    cacheMessage({ key: { id: 'CACHED1' }, message: { extendedTextMessage: { text: 'hi', contextInfo: fwd } } } as any);
    r = run({ quoted: { conversation: 'stripped' }, stanzaId: 'CACHED1' });
    await execute({}, r.ctx);
    assert.deepStrictEqual(r.calls, [['jid', NL]]);

    // errors
    r = run({});
    await execute({}, r.ctx);
    assert.ok(r.sent[0].includes('INVALID COMMAND SYNTAX'));

    r = run({ argsStr: 'https://example.com' });
    await execute({}, r.ctx);
    assert.ok(r.sent[0].includes('INVALID CHANNEL LINK') && r.calls.length === 0);

    r = run({ quoted: { conversation: 'nothing here' } });
    await execute({}, r.ctx);
    assert.ok(r.sent[0].includes('NO CHANNEL FOUND') && r.calls.length === 0);

    r = run({ argsStr: `whatsapp.com/channel/${CODE}`, meta: null });
    await execute({}, r.ctx);
    assert.ok(r.sent[0].includes('CHANNEL NOT FOUND'));

    r = run({ argsStr: `whatsapp.com/channel/${CODE}`, inviteThrows: true });
    await execute({}, r.ctx);
    assert.ok(r.sent[0].includes('LOOKUP FAILED'));

    // cooldown: same sender twice
    r = run({ argsStr: `whatsapp.com/channel/${CODE}` });
    await execute({}, r.ctx);
    await execute({}, r.ctx);
    assert.strictEqual(r.calls.length, 1);
    assert.ok(/wait \d+ seconds/.test(r.sent[1]));

    console.log('✓ check chid tests passed');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
