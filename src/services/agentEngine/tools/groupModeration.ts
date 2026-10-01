import { AgentTool, AgentExecutionContext, ToolExecutionResult, ToolAiPolicy } from '../types.js';
import { ModerationService, resolveTargetJid } from '../../moderationService.js';
import { cleanId } from '../../../utils/casino.js';
import { cleanPhoneNumber, maskPhoneNumber } from '../../../utils/phone.js';

/** Moderation actions that mutate group state and therefore require interactive confirmation. */
const MUTATING_ACTIONS = new Set([
    'kick',
    'close',
    'open',
    'invite',
    'approve',
    'reject',
    'promote',
    'demote',
    'rename',
    'description',
    'blacklist_add',
    'blacklist_remove'
]);

/** Moderation actions that only read group state and never mutate anything. */
const READ_ONLY_ACTIONS = new Set(['get_link', 'blacklist_list']);

/**
 * Resolves whether the caller is an admin of the target group.
 *
 * Delegates to `ModerationService.isUserAdmin` so that the agent path reuses the exact same
 * LID/JID aware resolution as the dot-prefixed `.group *` commands (Rule E), including the
 * group-creator short circuit. `isGroupAdmin` is intentionally re-derived here because
 * `AgentExecutionContext` does not propagate `SaraPromptContext.isGroupAdmin`.
 */
async function deriveIsGroupAdmin(modService: ModerationService, groupJid: string, ctx: AgentExecutionContext) {
    if (await modService.isUserAdmin(groupJid, ctx.callerJid)) return true;
    if (ctx.callerLid && (await modService.isUserAdmin(groupJid, ctx.callerLid))) return true;
    return false;
}

/**
 * Resolves a target JID for a moderation action.
 *
 * Priority order is deliberate and security-driven:
 *  1. Message metadata (mention or quoted reply) — never model-controlled, therefore trusted first.
 *  2. A model-supplied phone string — the LLM may echo digits the human actually typed, so it is
 *     sanitized through the shared multi-token phone normalizer before use (Rule AB).
 */
function resolveTarget(ctx: AgentExecutionContext, targetPhone: unknown): string | null {
    // `ctx.msg` is typed non-optional in AgentExecutionContext, but resolveTargetJid
    // dereferences `msg.message` unguarded. The optional chain is cheap insurance
    // against a crash in a tool that only exists to serve a confirmation prompt.
    const fromMessage = ctx.msg ? resolveTargetJid(ctx.msg) : null;
    if (fromMessage) return fromMessage;

    if (typeof targetPhone === 'string') {
        const digits = cleanPhoneNumber(targetPhone);
        if (digits.length >= 8 && digits.length <= 15) {
            return `${digits}@s.whatsapp.net`;
        }
    }
    return null;
}

/**
 * Sends a sensitive, identifier-bearing payload straight to the originating chat.
 *
 * Rule AB forbids exposing raw phone numbers to the LLM prompt. Read-only moderation results
 * (invite link, blacklist roster) are therefore delivered out-of-band and only a short,
 * identifier-free acknowledgement is handed back to the ReAct loop.
 */
async function deliverToChat(ctx: AgentExecutionContext, text: string): Promise<void> {
    await ctx.sock.sendMessage(ctx.chatJid, { text }, { quoted: ctx.msg });
}

/** Builds the confirmation prompt for a mutating action, or returns an error when arguments are unusable. */
function buildConfirmation(
    action: string,
    t: AgentExecutionContext['t'],
    targetDisplay: string | null,
    newName: string | undefined,
    newDescription: string | undefined,
    reason: string | undefined,
    invitePhone: string | undefined
): { prompt?: string; error?: string } {
    const suffix = t('tools.agent_moderation.confirm_suffix');

    switch (action) {
        case 'kick':
            return targetDisplay
                ? { prompt: `${t('tools.agent_moderation.confirm_kick', { target: targetDisplay })} ${suffix}` }
                : { error: t('tools.agent_moderation.no_target') };
        case 'close':
            return { prompt: `${t('tools.agent_moderation.confirm_close')} ${suffix}` };
        case 'open':
            return { prompt: `${t('tools.agent_moderation.confirm_open')} ${suffix}` };
        case 'invite':
            return invitePhone
                ? { prompt: `${t('tools.agent_moderation.confirm_invite', { phone: invitePhone })} ${suffix}` }
                : { error: t('tools.agent_moderation.no_phone') };
        case 'approve':
            return targetDisplay
                ? { prompt: `${t('tools.agent_moderation.confirm_approve', { target: targetDisplay })} ${suffix}` }
                : { error: t('tools.agent_moderation.no_target') };
        case 'reject':
            return targetDisplay
                ? { prompt: `${t('tools.agent_moderation.confirm_reject', { target: targetDisplay })} ${suffix}` }
                : { error: t('tools.agent_moderation.no_target') };
        case 'promote':
            return targetDisplay
                ? { prompt: `${t('tools.agent_moderation.confirm_promote', { target: targetDisplay })} ${suffix}` }
                : { error: t('tools.agent_moderation.no_target') };
        case 'demote':
            return targetDisplay
                ? { prompt: `${t('tools.agent_moderation.confirm_demote', { target: targetDisplay })} ${suffix}` }
                : { error: t('tools.agent_moderation.no_target') };
        case 'rename': {
            if (!newName) return { error: t('tools.agent_moderation.no_name') };
            if (newName.length > 25) return { error: t('tools.group_rename.too_long') };
            return { prompt: `${t('tools.agent_moderation.confirm_rename', { name: newName })} ${suffix}` };
        }
        case 'description': {
            if (!newDescription) return { error: t('tools.agent_moderation.no_description') };
            if (newDescription.length > 512) return { error: t('tools.group_description.too_long') };
            return { prompt: `${t('tools.agent_moderation.confirm_description')} ${suffix}` };
        }
        case 'blacklist_add':
            return targetDisplay
                ? {
                      prompt: `${t('tools.agent_moderation.confirm_blacklist_add', {
                          target: targetDisplay,
                          reason: reason || t('tools.group_blacklist_add.no_reason')
                      })} ${suffix}`
                  }
                : { error: t('tools.agent_moderation.no_target') };
        case 'blacklist_remove':
            return targetDisplay
                ? {
                      prompt: `${t('tools.agent_moderation.confirm_blacklist_remove', { target: targetDisplay })} ${suffix}`
                  }
                : { error: t('tools.agent_moderation.no_target') };
        default:
            return { error: t('tools.agent_moderation.unknown_action') };
    }
}

/** Masks a target JID so no raw phone number ever reaches the LLM context window (Rule AB). */
function maskTarget(jid: string): string {
    const masked = maskPhoneNumber(jid);
    return masked ? `@${masked}` : '@hidden';
}

/**
 * Normalizes the ModerationService status codes that have a dedicated localized message.
 * Any other code is returned verbatim so the surrounding caller's `*.error` template can
 * interpolate it as the diagnostic detail.
 */
function explainStatus(t: AgentExecutionContext['t'], message: string): string {
    switch (message) {
        case 'BOT_NOT_ADMIN':
            return t('tools.group_kick.bot_not_admin');
        case 'RATE_LIMIT_EXCEEDED':
            return t('core.rate_limited');
        default:
            return message;
    }
}

export const groupModerationTool: AgentTool = {
    name: 'group_moderation',
    description:
        'Performs group administration in the CURRENT group chat on behalf of a group admin: kick, close, open, invite, get_link, approve, reject, promote, demote, rename, description, blacklist_add, blacklist_remove, blacklist_list.',
    policy: ToolAiPolicy.CONFIRMATION_REQUIRED,
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: [
                    'kick',
                    'close',
                    'open',
                    'invite',
                    'get_link',
                    'approve',
                    'reject',
                    'promote',
                    'demote',
                    'rename',
                    'description',
                    'blacklist_add',
                    'blacklist_remove',
                    'blacklist_list'
                ],
                description: 'The moderation action to perform in the current group.'
            },
            targetPhone: {
                type: 'string',
                description:
                    'Target phone number in digits. Used by kick, invite, approve, reject, promote, demote, blacklist_add, and blacklist_remove. Omit when the admin is replying to a message or mentioning a member.'
            },
            newName: {
                type: 'string',
                description: 'The new group title for the rename action (1 to 25 characters).'
            },
            newDescription: {
                type: 'string',
                description: 'The new group description for the description action (1 to 512 characters).'
            },
            reason: {
                type: 'string',
                description: 'Optional reason recorded on the blacklist entry for blacklist_add.'
            }
        },
        required: ['action']
    },
    execute: async (args: Record<string, unknown>, ctx: AgentExecutionContext): Promise<ToolExecutionResult> => {
        const t = ctx.t;
        const action = typeof args.action === 'string' ? args.action.trim().toLowerCase() : '';
        const targetPhone = typeof args.targetPhone === 'string' ? args.targetPhone : undefined;
        const newName = typeof args.newName === 'string' ? args.newName.trim() : undefined;
        const newDescription = typeof args.newDescription === 'string' ? args.newDescription.trim() : undefined;
        const reason = typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim() : undefined;

        if (!MUTATING_ACTIONS.has(action) && !READ_ONLY_ACTIONS.has(action)) {
            return { success: false, error: t('tools.agent_moderation.unknown_action') };
        }

        // ── 1. Group context guard ────────────────────────────────────────────────
        // The target group is derived exclusively from ctx.chatJid and is never read from
        // model output (Rule AB zero-knowledge).
        const groupJid = ctx.chatJid;
        if (!groupJid.endsWith('@g.us')) {
            return { success: false, error: t('core.group_only') };
        }

        const modService = new ModerationService(ctx.sock);

        // ── 2. Caller admin re-derivation ─────────────────────────────────────────
        if (!(await deriveIsGroupAdmin(modService, groupJid, ctx))) {
            return { success: false, error: t('tools.group_kick.caller_not_admin') };
        }

        // ── 3. Read-only actions ──────────────────────────────────────────────────
        if (action === 'get_link') {
            const result = await modService.getGroupLink(groupJid, ctx.callerJid);
            if (!result.success) {
                return {
                    success: false,
                    error: explainStatus(t, result.message)
                };
            }
            const link = typeof result.data?.link === 'string' ? result.data.link : '';
            if (!link) {
                return { success: false, error: t('tools.group_link.error', { error: result.message }) };
            }
            // The invite link is a group secret: deliver it out-of-band, never to the LLM.
            await deliverToChat(ctx, t('tools.group_link.success', { link }));
            return { success: true, data: t('tools.agent_moderation.link_sent') };
        }

        if (action === 'blacklist_list') {
            const result = await modService.getBlacklist(groupJid);
            if (!result.success) {
                return { success: false, error: t('tools.group_blacklist_list.error', { error: result.message }) };
            }
            const entries = Array.isArray(result.data?.entries)
                ? (result.data.entries as Array<{ userJid: string; reason: string; addedAt: Date }>)
                : [];

            if (entries.length === 0) {
                return { success: true, data: t('tools.group_blacklist_list.empty') };
            }

            // The blacklist roster contains third-party phone numbers: deliver out-of-band.
            const header = t('tools.group_blacklist_list.title', { count: entries.length });
            const rendered = entries.map((entry) =>
                t('tools.group_blacklist_list.entry', {
                    target: maskTarget(entry.userJid),
                    reason: entry.reason,
                    date:
                        entry.addedAt instanceof Date
                            ? entry.addedAt.toISOString().split('T')[0]
                            : String(entry.addedAt || '')
                })
            );
            await deliverToChat(ctx, `${header}\n\n${rendered.join('\n\n')}`);
            return { success: true, data: t('tools.agent_moderation.blacklist_sent') };
        }

        // ── 4. Argument validation and confirmation staging ────────────────────────
        const invitePhone = action === 'invite' ? cleanPhoneNumber(targetPhone || '') : '';
        if (action === 'invite' && (invitePhone.length < 8 || invitePhone.length > 15)) {
            return { success: false, error: t('tools.group_invite.invalid_phone') };
        }

        const targetJid = action === 'invite' ? null : resolveTarget(ctx, targetPhone);
        // The confirmation prompt is delivered directly to the human, never to the LLM,
        // so it may show the resolved identifier verbatim.
        const targetDisplay = targetJid ? `@${cleanId(targetJid)}` : null;
        const maskedTarget = targetJid ? maskTarget(targetJid) : null;

        const confirmation = buildConfirmation(
            action,
            t,
            targetDisplay,
            newName,
            newDescription,
            reason,
            invitePhone || undefined
        );
        if (confirmation.error || !confirmation.prompt) {
            return { success: false, error: confirmation.error || t('tools.agent_moderation.unknown_action') };
        }

        const confirmed = args._confirmed === true;
        if (!confirmed) {
            return { success: true, requiresConfirmation: true, confirmationPrompt: confirmation.prompt };
        }

        // ── 5. Confirmed execution ────────────────────────────────────────────────
        // Guard rails are re-evaluated above on every invocation, including this confirmed
        // re-entry, so admin status is validated against live metadata at execution time (TOCTOU).
        try {
            switch (action) {
                case 'kick': {
                    const r = await modService.kickMember(
                        groupJid,
                        targetJid!,
                        `Kicked on admin request via Sara AI`,
                        ctx.callerJid
                    );
                    if (r.success)
                        return { success: true, data: t('tools.group_kick.success', { target: maskedTarget }) };
                    if (r.message === 'TARGET_IS_ADMIN')
                        return {
                            success: false,
                            error: t('tools.group_kick.target_is_admin', { target: maskedTarget })
                        };
                    if (r.message === 'TARGET_IS_SELF')
                        return { success: false, error: t('tools.group_kick.target_is_self') };
                    if (r.message === 'TARGET_NOT_MEMBER')
                        return {
                            success: false,
                            error: t('tools.group_kick.target_not_member', { target: maskedTarget })
                        };
                    return { success: false, error: explainStatus(t, r.message) };
                }

                case 'close': {
                    const r = await modService.setGroupAnnounce(groupJid, true, ctx.callerJid);
                    if (r.success) return { success: true, data: t('tools.group_close.success') };
                    if (r.message === 'ALREADY_CLOSED')
                        return { success: false, error: t('tools.group_close.already_closed') };
                    return {
                        success: false,
                        error: t('tools.group_close.error', { error: explainStatus(t, r.message) })
                    };
                }

                case 'open': {
                    const r = await modService.setGroupAnnounce(groupJid, false, ctx.callerJid);
                    if (r.success) return { success: true, data: t('tools.group_open.success') };
                    if (r.message === 'ALREADY_OPEN')
                        return { success: false, error: t('tools.group_open.already_open') };
                    return {
                        success: false,
                        error: t('tools.group_open.error', { error: explainStatus(t, r.message) })
                    };
                }

                case 'invite': {
                    const r = await modService.inviteMember(groupJid, invitePhone, ctx.callerName, ctx.callerJid, t);
                    if (r.success)
                        return {
                            success: true,
                            data: t('tools.group_invite.success', { phone: maskPhoneNumber(invitePhone) })
                        };
                    if (r.message === 'ALREADY_MEMBER')
                        return {
                            success: false,
                            error: t('tools.group_invite.already_member', { phone: maskPhoneNumber(invitePhone) })
                        };
                    if (r.message === 'DM_FAILED')
                        return {
                            success: false,
                            error: t('tools.group_invite.dm_failed', { phone: maskPhoneNumber(invitePhone) })
                        };
                    return {
                        success: false,
                        error: t('tools.group_invite.error', {
                            phone: maskPhoneNumber(invitePhone),
                            error: explainStatus(t, r.message)
                        })
                    };
                }

                case 'approve': {
                    const r = await modService.approveJoinRequest(groupJid, targetJid!, ctx.callerJid);
                    if (r.success)
                        return {
                            success: true,
                            data: t('tools.group_approve.success', { phone: maskPhoneNumber(targetJid!) })
                        };
                    return {
                        success: false,
                        error: t('tools.group_approve.error', { error: explainStatus(t, r.message) })
                    };
                }

                case 'reject': {
                    const r = await modService.rejectJoinRequest(groupJid, targetJid!, ctx.callerJid);
                    if (r.success)
                        return { success: true, data: t('tools.group_reject.success', { target: maskedTarget }) };
                    return {
                        success: false,
                        error: t('tools.group_reject.error', { error: explainStatus(t, r.message) })
                    };
                }

                case 'promote': {
                    const r = await modService.promoteAdmin(groupJid, targetJid!, ctx.callerJid);
                    if (r.success)
                        return { success: true, data: t('tools.group_promote.success', { target: maskedTarget }) };
                    if (r.message === 'ALREADY_ADMIN')
                        return {
                            success: false,
                            error: t('tools.group_promote.already_admin', { target: maskedTarget })
                        };
                    if (r.message === 'TARGET_NOT_MEMBER')
                        return {
                            success: false,
                            error: t('tools.group_promote.target_not_member', { target: maskedTarget })
                        };
                    return {
                        success: false,
                        error: t('tools.group_promote.error', {
                            target: maskedTarget,
                            error: explainStatus(t, r.message)
                        })
                    };
                }

                case 'demote': {
                    const r = await modService.demoteAdmin(groupJid, targetJid!, ctx.callerJid);
                    if (r.success)
                        return { success: true, data: t('tools.group_demote.success', { target: maskedTarget }) };
                    if (r.message === 'NOT_ADMIN')
                        return { success: false, error: t('tools.group_demote.not_admin', { target: maskedTarget }) };
                    if (r.message === 'TARGET_IS_CREATOR')
                        return {
                            success: false,
                            error: t('tools.group_demote.target_is_creator', { target: maskedTarget })
                        };
                    return {
                        success: false,
                        error: t('tools.group_demote.error', {
                            target: maskedTarget,
                            error: explainStatus(t, r.message)
                        })
                    };
                }

                case 'rename': {
                    const r = await modService.updateGroupSubject(groupJid, newName!, ctx.callerJid);
                    if (r.success) return { success: true, data: t('tools.group_rename.success', { name: newName }) };
                    if (r.message === 'TOO_SHORT') return { success: false, error: t('tools.group_rename.too_short') };
                    if (r.message === 'TOO_LONG') return { success: false, error: t('tools.group_rename.too_long') };
                    return {
                        success: false,
                        error: t('tools.group_rename.error', { error: explainStatus(t, r.message) })
                    };
                }

                case 'description': {
                    const r = await modService.updateGroupDescription(groupJid, newDescription!, ctx.callerJid);
                    if (r.success) return { success: true, data: t('tools.group_description.success') };
                    if (r.message === 'EMPTY') return { success: false, error: t('tools.group_description.empty') };
                    if (r.message === 'TOO_LONG')
                        return { success: false, error: t('tools.group_description.too_long') };
                    return {
                        success: false,
                        error: t('tools.group_description.error', { error: explainStatus(t, r.message) })
                    };
                }

                case 'blacklist_add': {
                    const r = await modService.addToBlacklist(
                        groupJid,
                        targetJid!,
                        reason || t('tools.group_blacklist_add.no_reason'),
                        ctx.callerJid
                    );
                    if (r.success) return { success: true, data: t('tools.agent_moderation.blacklist_added') };
                    if (r.message === 'ALREADY_BLACKLISTED')
                        return {
                            success: false,
                            error: t('tools.group_blacklist_add.already_blacklisted', { target: maskedTarget })
                        };
                    return {
                        success: false,
                        error: t('tools.group_blacklist_add.error', {
                            target: maskedTarget,
                            error: explainStatus(t, r.message)
                        })
                    };
                }

                case 'blacklist_remove': {
                    const r = await modService.removeFromBlacklist(groupJid, targetJid!, ctx.callerJid);
                    if (r.success) return { success: true, data: t('tools.agent_moderation.blacklist_removed') };
                    if (r.message === 'NOT_BLACKLISTED')
                        return {
                            success: false,
                            error: t('tools.group_blacklist_remove.not_blacklisted', { target: maskedTarget })
                        };
                    return {
                        success: false,
                        error: t('tools.group_blacklist_remove.error', {
                            target: maskedTarget,
                            error: explainStatus(t, r.message)
                        })
                    };
                }

                default:
                    return { success: false, error: t('tools.agent_moderation.unknown_action') };
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[groupModerationTool] Execution error for action "${action}":`, err);
            return {
                success: false,
                error: t('core.tool_execution_error', { tool: 'group_moderation' }) + ` (${msg})`
            };
        }
    }
};
