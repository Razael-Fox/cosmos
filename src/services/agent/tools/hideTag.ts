import { AgentTool, AgentExecutionContext, ToolExecutionResult, ToolAiPolicy } from '../types.js';
import { ModerationService } from '../../moderationService.js';
import { cleanId } from '../../../lib/casino.js';
import { isOwnerId } from '../../../lib/owner.js';
import { getTierCached, tryConsume } from '../../../lib/featureLimiter.js';
import { TIER_LIMITS } from '../../quotaService.js';
import { extractWebPage } from '../tavilyClient.js';
import {
    execute as executeHideTagCommand,
    extractQuotedText,
    MAX_HIDETAG_CHARS
} from '../../../commands/group/hideTag.js';

/** Preview length in the confirmation prompt; the full body still dispatches on confirm. */
const CONFIRM_PREVIEW_CHARS = 200;

// Test seam so the suite can stub page extraction without network/Tavily.
export const hideTagAgentDeps: { extractPage: (url: string) => Promise<import('../tavilyClient.js').WebPageExtractOutcome> } = {
    extractPage: (url: string) => extractWebPage(url)
};

/** Counts taggable members (bot excluded) from live metadata. */
async function countTaggable(sock: AgentExecutionContext['sock'], groupJid: string): Promise<number> {
    try {
        const metadata = await sock.groupMetadata(groupJid);
        const botId = cleanId((sock.user as { id?: string } | undefined)?.id);
        const botLid = cleanId((sock.user as { lid?: string } | undefined)?.lid);
        let count = 0;
        for (const p of metadata?.participants ?? []) {
            const ids = [cleanId(p.id), cleanId((p as { lid?: string }).lid)].filter(Boolean);
            if (ids.length === 0 || ids.includes(botId) || (botLid && ids.includes(botLid))) continue;
            count++;
        }
        return count;
    } catch (err) {
        console.error('[hideTagTool] Failed to count taggable members:', err);
        return 0;
    }
}

/**
 * Re-derives caller admin status (callerJid + callerLid) so the agent path
 * reuses the exact same gate as the dot-prefixed command, including at
 * confirmed-execution time (TOCTOU).
 */
async function deriveIsGroupAdmin(
    modService: ModerationService,
    groupJid: string,
    ctx: AgentExecutionContext
): Promise<boolean> {
    if (await modService.isUserAdmin(groupJid, ctx.callerJid)) return true;
    if (ctx.callerLid && (await modService.isUserAdmin(groupJid, ctx.callerLid))) return true;
    return false;
}

/** Deterministic ≤3-sentence summary: first sentences of the extract, no new LLM call. */
function firstSentences(text: string, max: number): string {
    const sentences = text
        .replace(/\s+/g, ' ')
        .trim()
        .split(/(?<=[.!?…])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    return sentences.slice(0, max).join(' ').trim();
}

function truncateWords(text: string, limit: number): string {
    const clean = text.trim();
    if (clean.length <= limit) return clean;
    const slice = clean.slice(0, limit - 1);
    const lastSpace = slice.lastIndexOf(' ');
    return `${(lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

export const hideTagTool: AgentTool = {
    name: 'hidetag',
    description:
        'Announces a message to the CURRENT group while tagging all members invisibly (no visible @-list). Admin only. Provide the verbatim announcement in "message", or a page/file URL in "url" to announce its content; set "summarize" to announce a 3-sentence summary instead of the full extract.',
    policy: ToolAiPolicy.CONFIRMATION_REQUIRED,
    parameters: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'Verbatim announcement body: direct phrase, quoted text, or user-supplied text.'
            },
            url: {
                type: 'string',
                description: 'Page or raw-file URL whose readable content becomes the announcement.'
            },
            summarize: {
                type: 'boolean',
                description: 'Announce a 3-sentence summary of the extracted content instead of the full text.'
            }
        },
        required: []
    },
    execute: async (args: Record<string, unknown>, ctx: AgentExecutionContext): Promise<ToolExecutionResult> => {
        const t = ctx.t;
        const message = typeof args.message === 'string' ? args.message.trim() : '';
        const url = typeof args.url === 'string' ? args.url.trim() : '';
        const summarize = args.summarize === true;

        // ── 1. Group context guard (target group only from ctx.chatJid) ──
        const groupJid = ctx.chatJid;
        if (!groupJid.endsWith('@g.us')) {
            return { success: false, error: t('core.group_only') };
        }

        const modService = new ModerationService(ctx.sock);

        // ── 2. Caller admin re-derivation (also runs on confirmed re-entry) ──
        if (!(await deriveIsGroupAdmin(modService, groupJid, ctx))) {
            return { success: false, error: t('tools.tag_hide.caller_not_admin') };
        }

        // ── 3. Body resolution ──
        let body = message;
        if (!body && url) {
            if (!/^https?:\/\/\S+$/i.test(url)) {
                return { success: false, error: t('tools.tag_hide.sara_no_text') };
            }
            const page = await hideTagAgentDeps.extractPage(url);
            if (page.kind !== 'ok' || !page.text) {
                return { success: false, error: t('tools.tag_hide.sara_no_text') };
            }
            body = page.text;
        }
        if (!body && ctx.msg) {
            body = extractQuotedText(ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage);
        }
        if (!body) {
            return { success: false, error: t('tools.tag_hide.sara_no_text') };
        }
        if (summarize) {
            body = firstSentences(body, 3) || body;
        }
        body = truncateWords(body, MAX_HIDETAG_CHARS);

        // ── 4. Confirmation staging (count + preview, never JIDs) ──
        // The resolved body is staged with the action so the confirmed
        // dispatch sends exactly what the human previewed — no re-fetch.
        const confirmed = args._confirmed === true;
        if (!confirmed) {
            const count = await countTaggable(ctx.sock, groupJid);
            const preview = body.length > CONFIRM_PREVIEW_CHARS ? `${body.slice(0, CONFIRM_PREVIEW_CHARS)}…` : body;
            const prompt = `${t('tools.tag_hide.sara_confirm', { count, preview })} ${t('tools.agent_moderation.confirm_suffix')}`;
            return {
                success: true,
                requiresConfirmation: true,
                confirmationPrompt: prompt,
                stagedArguments: { message: body }
            };
        }

        // ── 5. Confirmed execution ──
        // Guards above re-ran on this re-entry, so admin status is live (TOCTOU).
        // The agent path bypasses the CommandsHandler funnel, so the per-plan
        // ceiling is consumed explicitly here; only real dispatches are metered.
        if (!isOwnerId(ctx.callerJid)) {
            const tier = await getTierCached(ctx.callerJid);
            const ceiling = TIER_LIMITS[tier]?.featureLimits?.hidetag ?? { max: 3, windowMs: 600_000 };
            if (!tryConsume(`hidetag:${ctx.callerJid}`, ceiling.max, ceiling.windowMs)) {
                const minutes = Math.ceil(ceiling.windowMs / 60_000);
                return { success: false, error: t('core.limits.cooldown', { minutes }) };
            }
        }

        // Dispatch reuses the hardened dot-command path (bot exclusion, LID map,
        // unquoted self-send returning void), adapted onto the agent context.
        const cmdCtx = {
            sock: ctx.sock,
            msg: ctx.msg,
            jid: groupJid,
            t: ((key: string, vars?: Record<string, unknown>) => t(key, vars)) as (
                key: string,
                variablesOrFallback?: Record<string, unknown> | string,
                variables?: Record<string, unknown>
            ) => string,
            lang: ctx.locale,
            commandName: '.tag hide',
            argsStr: ''
        };
        const result = await executeHideTagCommand({ message: body }, cmdCtx);
        if (typeof result === 'string' && result.trim()) {
            return { success: false, error: result };
        }

        // The acknowledgement is synthesized by Tier 2 from these outcome
        // facts (see executionLoop staged closure); the static follow-up rides
        // along only as a fallback. Facts carry a member count, never the
        // announcement text — URL extracts are untrusted external data and
        // must not re-enter an LLM context.
        const members = await countTaggable(ctx.sock, groupJid);
        return {
            success: true,
            data: { followup: t('tools.tag_hide.sara_followup'), members },
            synthesizeFollowup: true
        };
    }
};
