import assert from 'assert';
import { hideTagTool } from '../src/services/agent/tools/hideTag.js';
import { AgentToolRegistry } from '../src/services/agent/tools/registry.js';
import { AgentToolPolicyManager } from '../src/services/agent/policy.js';
import { ToolAiPolicy } from '../src/services/agent/types.js';
import { buildSaraGuidancePrompt } from '../src/services/agent/prompts/saraGuidance.js';
import { buildSaraPersonaPrompt } from '../src/services/agent/prompts/saraPersona.js';
import { extractWebPage, stripHtmlToText } from '../src/services/agent/tavilyClient.js';
import { getTranslator } from '../src/lib/i18n.js';
import type { AgentExecutionContext } from '../src/services/agent/types.js';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test_groq_api_key';
process.env.OWNER_PHONE_NUMBER = '6281200000101';

const GROUP_JID = '120363088888888888@g.us';
const BOT_JID = '6289999999999@s.whatsapp.net';
const ADMIN_JID = '6281111111111@s.whatsapp.net';
const MEMBER_A = '6282222222222@s.whatsapp.net';
const MEMBER_B = '6283333333333@s.whatsapp.net';
const QUOTA_JID = '6284444444444@s.whatsapp.net';

interface SentMessage {
    jid: string;
    text: string;
    mentions?: string[];
    quoted?: boolean;
}

function adminParticipants(): any[] {
    return [{ id: BOT_JID }, { id: ADMIN_JID, admin: 'admin' }, { id: MEMBER_A }, { id: MEMBER_B }];
}

function quotaParticipants(): any[] {
    return [{ id: BOT_JID }, { id: QUOTA_JID, admin: 'admin' }, { id: MEMBER_A }];
}

function createExecCtx(options: {
    chatJid?: string;
    caller?: string;
    lang?: 'en' | 'id';
    participants?: any[];
    message?: any;
}): { ctx: AgentExecutionContext; sent: SentMessage[] } {
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
            key: { remoteJid: options.chatJid ?? GROUP_JID, participant: options.caller ?? ADMIN_JID },
            message: options.message ?? {}
        },
        chatJid: options.chatJid ?? GROUP_JID,
        callerJid: options.caller ?? ADMIN_JID,
        callerName: 'Admin',
        isOwner: false,
        locale: options.lang ?? 'en',
        t: getTranslator(options.lang ?? 'en')
    } as unknown as AgentExecutionContext;
    return { ctx, sent };
}

function dummyPromptCtx(overrides: Record<string, unknown> = {}): any {
    return {
        callerName: 'Admin',
        callerJid: ADMIN_JID,
        isOwner: false,
        isGroupAdmin: true,
        hasIdCard: true,
        chatType: 'group',
        chatJid: GROUP_JID,
        botName: 'Cosmos',
        locale: 'en',
        knownContactTokens: [],
        ...overrides
    };
}

async function runTests() {
    console.log('--- STARTING HIDETAG AGENT GATE TESTS ---');

    // [Test 1] Registration, policy, Tier 1 + persona wiring
    console.log('[Test 1] Testing registry, policy, and prompt wiring...');
    assert.strictEqual(AgentToolRegistry.getTool('hidetag')?.name, 'hidetag');
    assert.strictEqual(AgentToolRegistry.getTool('Hidetag')?.name, 'hidetag');
    assert.strictEqual(hideTagTool.policy, ToolAiPolicy.CONFIRMATION_REQUIRED);
    assert.strictEqual(AgentToolPolicyManager.getPolicy('hidetag'), ToolAiPolicy.CONFIRMATION_REQUIRED);
    assert.strictEqual(AgentToolRegistry.getScopedGroqTools('hidetag').length, 1);
    assert.ok(buildSaraGuidancePrompt(dummyPromptCtx()).includes('"hidetag"'), 'Tier 1 must list the hidetag candidate');
    assert.ok(
        buildSaraPersonaPrompt(dummyPromptCtx(), false).includes('Hidetag separation'),
        'Persona must carry the no-chatter rule'
    );
    console.log('✓ Registry, policy, and prompt wiring verified.');

    // [Test 2] Group-only + admin gates
    console.log('[Test 2] Testing group and admin guards...');
    {
        const { ctx } = createExecCtx({ chatJid: '628123456789@s.whatsapp.net' });
        const result = await hideTagTool.execute({ message: 'hi' }, ctx);
        assert.strictEqual(result.success, false);
    }
    {
        const { ctx } = createExecCtx({ caller: MEMBER_A, participants: adminParticipants() });
        const result = await hideTagTool.execute({ message: 'hi' }, ctx);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error, getTranslator('en')('tools.tag_hide.caller_not_admin'));
    }
    console.log('✓ Group and admin guards verified.');

    // [Test 3] No text source → sara_no_text
    console.log('[Test 3] Testing empty-body rejection...');
    {
        const { ctx } = createExecCtx({ participants: adminParticipants() });
        const result = await hideTagTool.execute({}, ctx);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error, getTranslator('en')('tools.tag_hide.sara_no_text'));
    }
    console.log('✓ Empty-body rejection verified.');

    // [Test 4] Staging: confirmation prompt with count + preview, no dispatch
    console.log('[Test 4] Testing confirmation staging...');
    {
        const { ctx, sent } = createExecCtx({ participants: adminParticipants() });
        const result = await hideTagTool.execute({ message: 'Meeting at 7 PM' }, ctx);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.requiresConfirmation, true);
        assert.ok(result.confirmationPrompt?.includes('3 members'), `Got: ${result.confirmationPrompt}`);
        assert.ok(result.confirmationPrompt?.includes('Meeting at 7 PM'));
        assert.ok(result.confirmationPrompt?.includes('.confirm'));
        assert.strictEqual(sent.length, 0, 'Staging must not dispatch');
    }
    console.log('✓ Confirmation staging verified.');

    // [Test 5] Confirmed dispatch: unquoted announcement + quoted follow-up data
    console.log('[Test 5] Testing confirmed dispatch...');
    {
        const { ctx, sent } = createExecCtx({ participants: adminParticipants() });
        const result = await hideTagTool.execute({ message: 'Meeting at 7 PM', _confirmed: true }, ctx);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data, getTranslator('en')('tools.tag_hide.sara_followup'));
        assert.strictEqual(sent.length, 1);
        assert.ok(sent[0].text.startsWith('Meeting at 7 PM'));
        assert.ok(!sent[0].text.includes('@'), 'No visible @-list in the announcement');
        assert.strictEqual(sent[0].quoted, false, 'Announcement must be unquoted');
        const mentions = sent[0].mentions ?? [];
        assert.ok(mentions.includes(MEMBER_A) && mentions.includes(MEMBER_B));
        assert.ok(!mentions.includes(BOT_JID));
    }
    console.log('✓ Confirmed dispatch verified.');

    // [Test 6] TOCTOU: admin revoked between staging and confirm → refused
    console.log('[Test 6] Testing admin re-derivation on confirm...');
    {
        const demoted = [{ id: BOT_JID }, { id: ADMIN_JID }, { id: MEMBER_A }, { id: MEMBER_B }];
        const { ctx, sent } = createExecCtx({ participants: demoted });
        const result = await hideTagTool.execute({ message: 'hi', _confirmed: true }, ctx);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error, getTranslator('en')('tools.tag_hide.caller_not_admin'));
        assert.strictEqual(sent.length, 0, 'Revoked admin must dispatch nothing');
    }
    console.log('✓ Admin re-derivation verified.');

    // [Test 7] Explicit per-plan ceiling (FREE 3 / 10 min), then cooldown
    console.log('[Test 7] Testing explicit quota consumption...');
    {
        const { ctx, sent } = createExecCtx({ caller: QUOTA_JID, participants: quotaParticipants() });
        for (let i = 0; i < 3; i++) {
            const result = await hideTagTool.execute({ message: `ping ${i}`, _confirmed: true }, ctx);
            assert.strictEqual(result.success, true, `Dispatch ${i} must succeed`);
        }
        assert.strictEqual(sent.length, 3);
        const limited = await hideTagTool.execute({ message: 'one too many', _confirmed: true }, ctx);
        assert.strictEqual(limited.success, false);
        assert.ok(String(limited.error).includes('10'), `Cooldown must name the window, got: ${limited.error}`);
        assert.strictEqual(sent.length, 3, 'Throttled dispatch must not send');
    }
    console.log('✓ Explicit quota consumption verified.');

    // [Test 8] Summarize flag compresses to 3 sentences
    console.log('[Test 8] Testing summarize flag...');
    {
        const { ctx, sent } = createExecCtx({ participants: adminParticipants() });
        const staged = await hideTagTool.execute(
            { message: 'One. Two. Three. Four. Five.', summarize: true },
            ctx
        );
        assert.ok(staged.confirmationPrompt?.includes('One. Two. Three.'));
        assert.ok(!staged.confirmationPrompt?.includes('Four'));
        const done = await hideTagTool.execute(
            { message: 'One. Two. Three. Four. Five.', summarize: true, _confirmed: true },
            ctx
        );
        assert.strictEqual(done.success, true);
        assert.ok(sent[0].text.startsWith('One. Two. Three.'));
        assert.ok(!sent[0].text.includes('Four'));
    }
    console.log('✓ Summarize flag verified.');

    // [Test 9] Page extraction helpers (offline-deterministic paths)
    console.log('[Test 9] Testing extraction helpers...');
    assert.strictEqual(stripHtmlToText('<script>alert(1)</script><p>Hello &amp; bye</p>'), 'Hello & bye');
    assert.strictEqual(stripHtmlToText('<style>.x{color:red}</style>  a  b'), 'a b');
    const badScheme = await extractWebPage('notaurl');
    assert.strictEqual(badScheme.kind, 'unavailable');
    const ftp = await extractWebPage('ftp://example.com/x.txt');
    assert.strictEqual(ftp.kind, 'unavailable');
    console.log('✓ Extraction helpers verified.');

    console.log('--- ALL HIDETAG AGENT GATE TESTS PASSED ---');
}

runTests().catch((err) => {
    console.error('HIDETAG AGENT GATE TESTS FAILED:', err);
    process.exit(1);
});
