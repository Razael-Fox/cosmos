import assert from 'assert';
import { hideTagTool, hideTagAgentDeps } from '../src/services/agent/tools/hideTag.js';
import { AgentToolRegistry } from '../src/services/agent/tools/registry.js';
import { AgentToolPolicyManager } from '../src/services/agent/policy.js';
import { ToolAiPolicy } from '../src/services/agent/types.js';
import { AgentExecutionLoop } from '../src/services/agent/executionLoop.js';
import { AgentConfirmationManager } from '../src/services/agent/confirmationManager.js';
import { AgentGroqClient } from '../src/services/agent/groqClient.js';
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
const STAGE_JID = '6285555555555@s.whatsapp.net';
const CAP_JID = '6286666666666@s.whatsapp.net';

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

function adminAs(jid: string): any[] {
    return [{ id: BOT_JID }, { id: jid, admin: 'admin' }, { id: MEMBER_A }, { id: MEMBER_B }];
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
            sendPresenceUpdate: async () => {},
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
        assert.deepStrictEqual(result.stagedArguments, { message: 'Meeting at 7 PM' });
        assert.strictEqual(sent.length, 0, 'Staging must not dispatch');
    }
    console.log('✓ Confirmation staging verified.');

    // [Test 5] Confirmed dispatch: unquoted announcement + facts for synthesis
    console.log('[Test 5] Testing confirmed dispatch...');
    {
        const { ctx, sent } = createExecCtx({ participants: adminParticipants() });
        const result = await hideTagTool.execute({ message: 'Meeting at 7 PM', _confirmed: true }, ctx);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.synthesizeFollowup, true);
        const data = result.data as Record<string, unknown>;
        assert.strictEqual(data.followup, getTranslator('en')('tools.tag_hide.sara_followup'));
        assert.strictEqual(data.members, 3);
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].jid, GROUP_JID, 'Announcement stays in the originating chat');
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

    // [Test 11] Fix B: staged body is dispatched verbatim on confirm even
    // when the page changes afterwards — full loop with arg spy.
    console.log('[Test 11] Testing staged-body reuse on confirm...');
    const realExtract = hideTagAgentDeps.extractPage;
    const realGetTool = AgentToolRegistry.getTool;
    const realCompletion11 = AgentGroqClient.createCompletion;
    try {
        let pageText = 'staged v1 body';
        hideTagAgentDeps.extractPage = (async () => ({ kind: 'ok', text: pageText }) as const) as typeof realExtract;
        const confirmCalls: Array<Record<string, unknown>> = [];
        (AgentToolRegistry as any).getTool = (name: string) => {
            const tool = realGetTool.call(AgentToolRegistry, name);
            if (tool?.name !== 'hidetag') return tool;
            return {
                ...tool,
                execute: async (args: Record<string, unknown>, c: any) => {
                    confirmCalls.push({ ...args });
                    return tool.execute(args, c);
                }
            };
        };
        let synthCalls = 0;
        AgentGroqClient.createCompletion = (async () => {
            synthCalls++;
            if (synthCalls === 1) {
                return {
                    message: {
                        content: null,
                        tool_calls: [
                            {
                                id: 'call_b',
                                type: 'function',
                                function: { name: 'hidetag', arguments: JSON.stringify({ url: 'https://example.com/p.txt' }) }
                            }
                        ]
                    },
                    finishReason: 'tool_calls'
                };
            }
            return { message: { content: 'AI ack', tool_calls: [] }, finishReason: 'stop' };
        }) as typeof realCompletion11;

        const { ctx, sent } = createExecCtx({ caller: STAGE_JID, participants: adminAs(STAGE_JID) });
        const staged = await AgentExecutionLoop.run(
            '.sara hidetag https://example.com/p.txt',
            dummyPromptCtx({ callerJid: STAGE_JID }),
            ctx,
            { intent: 'HIDETAG', primaryTool: 'hidetag', confidence: 1, guidanceInstructions: '', docQuestion: false }
        );
        assert.ok(staged.includes('staged v1 body'), `Preview must show staged text, got: ${staged}`);

        pageText = 'evil v2 body';
        const handled = await AgentConfirmationManager.processConfirmation(
            ctx.sock as any,
            ctx.msg as any,
            STAGE_JID,
            GROUP_JID,
            '.confirm'
        );
        assert.strictEqual(handled, true);
        assert.strictEqual(confirmCalls.length, 2, 'Staging call + one confirmed re-entry');
        assert.deepStrictEqual(confirmCalls[1], { message: 'staged v1 body', _confirmed: true });
        assert.strictEqual(sent.length, 2);
        assert.ok(sent[0].text.startsWith('staged v1 body'), `Must dispatch staged text, got: ${sent[0].text}`);
        assert.ok(!sent[0].text.includes('evil'));
        assert.strictEqual(sent[1].text, 'AI ack');
    } finally {
        hideTagAgentDeps.extractPage = realExtract;
        (AgentToolRegistry as any).getTool = realGetTool;
        AgentGroqClient.createCompletion = realCompletion11;
        AgentConfirmationManager.clearAll();
    }
    console.log('✓ Staged-body reuse verified.');

    // [Test 12] Fix C: truncation never exceeds the cap (limit - 1 + ellipsis).
    console.log('[Test 12] Testing truncation cap...');
    {
        const { ctx, sent } = createExecCtx({ caller: CAP_JID, participants: adminAs(CAP_JID) });
        const big = 'x'.repeat(4500);
        const done = await hideTagTool.execute({ message: big, _confirmed: true }, ctx);
        assert.strictEqual(done.success, true);
        const body = sent[0].text.replace(/\n\u200B$/, '');
        assert.ok(body.length <= 4000, `Body must fit the cap, got ${body.length}`);
        assert.ok(body.endsWith('…'));
    }
    console.log('✓ Truncation cap verified.');

    // [Test 9] Page extraction helpers (offline-deterministic paths)
    console.log('[Test 9] Testing extraction helpers...');
    assert.strictEqual(stripHtmlToText('<script>alert(1)</script><p>Hello &amp; bye</p>'), 'Hello & bye');
    assert.strictEqual(stripHtmlToText('<style>.x{color:red}</style>  a  b'), 'a b');
    const badScheme = await extractWebPage('notaurl');
    assert.strictEqual(badScheme.kind, 'unavailable');
    const ftp = await extractWebPage('ftp://example.com/x.txt');
    assert.strictEqual(ftp.kind, 'unavailable');
    console.log('✓ Extraction helpers verified.');

    // [Test 10] End-to-end: stage → .confirm → unquoted announcement +
    // AI-generated follow-up, both in the originating chat.
    console.log('[Test 10] Testing end-to-end confirm flow with AI follow-up...');
    AgentConfirmationManager.clearAll();
    const realCompletion = AgentGroqClient.createCompletion;
    try {
        let calls = 0;
        AgentGroqClient.createCompletion = (async () => {
            calls++;
            if (calls === 1) {
                return {
                    message: {
                        content: null,
                        tool_calls: [
                            {
                                id: 'call_1',
                                type: 'function',
                                function: { name: 'hidetag', arguments: JSON.stringify({ message: 'E2E hello' }) }
                            }
                        ]
                    },
                    finishReason: 'tool_calls'
                };
            }
            return {
                message: { content: 'Done — everyone has been tagged! Anything else to announce?', tool_calls: [] },
                finishReason: 'stop'
            };
        }) as typeof realCompletion;

        const { ctx, sent } = createExecCtx({ participants: adminParticipants() });
        const staged = await AgentExecutionLoop.run(
            '.sara hidetag E2E hello',
            dummyPromptCtx(),
            ctx,
            { intent: 'HIDETAG', primaryTool: 'hidetag', confidence: 1, guidanceInstructions: '', docQuestion: false }
        );
        assert.ok(staged.includes('3 members'), `Staging prompt must show the count, got: ${staged}`);
        assert.strictEqual(sent.length, 0, 'Nothing dispatched before confirm');

        const handled = await AgentConfirmationManager.processConfirmation(
            ctx.sock as any,
            ctx.msg as any,
            ADMIN_JID,
            GROUP_JID,
            '.confirm'
        );
        assert.strictEqual(handled, true);
        assert.strictEqual(sent.length, 2, 'Announcement + follow-up must both send');
        assert.strictEqual(sent[0].jid, GROUP_JID);
        assert.strictEqual(sent[1].jid, GROUP_JID, 'Follow-up stays in the originating chat');
        assert.ok(sent[0].text.startsWith('E2E hello'));
        assert.strictEqual(sent[0].quoted, false);
        assert.strictEqual(sent[1].text, 'Done — everyone has been tagged! Anything else to announce?');
        assert.strictEqual(sent[1].quoted, true, 'Follow-up is a quoted reply in context');
        assert.notStrictEqual(
            sent[1].text,
            getTranslator('en')('tools.tag_hide.sara_followup'),
            'Follow-up must be AI-generated, not the static string'
        );
    } finally {
        AgentGroqClient.createCompletion = realCompletion;
        AgentConfirmationManager.clearAll();
    }
    console.log('✓ End-to-end confirm flow verified.');

    console.log('--- ALL HIDETAG AGENT GATE TESTS PASSED ---');
}

runTests().catch((err) => {
    console.error('HIDETAG AGENT GATE TESTS FAILED:', err);
    process.exit(1);
});
