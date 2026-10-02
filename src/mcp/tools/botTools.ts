/**
 * Cosmos MCP Server — `cosmos_bot_*` tool group.
 *
 * Live bot actions, all proxied over the authenticated IPC bridge to the engine
 * that owns the Baileys sockets (AGENTS.md Rule Y). When the engine is
 * unreachable every tool returns `BOT_OFFLINE`; nothing is ever fabricated.
 *
 * The headline capability is `cosmos_bot_broadcast`, which answers the request
 * from issue #49 — "broadcast to all groups with a 5-second delay per group" —
 * with a single validated, audited, persisted tool call.
 */
import { recordAudit } from '../audit.js';
import { loadMcpConfig } from '../config.js';
import { McpToolError } from '../errors.js';
import { issueContactRef, maskJid, maskPhone, resolveContactRef } from '../privacy.js';
import { sendIpcEnvelope, sendIpcOrThrow } from '../bridge/botBridge.js';
import { registerTool, zod, type ToolRegistrar } from '../registry.js';

interface IpcErrorBody {
    error?: string;
}

/** Normalises a numeric field from an IPC payload. */
function numberOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Formal English sanity check for operator-authored outbound text. Rule H
 * requires output strings to be Formal English; this rejects the most common
 * Indonesian markers so a careless broadcast is caught before it ships.
 */
function assertFormalEnglish(message: string): void {
    const indonesianMarkers = [
        /\bsaya\b/i,
        /\bkamu\b/i,
        /\banda\b/i,
        /\bterima kasih\b/i,
        /\bsedang dalam proses\b/i,
        /\bakan segera\b/i,
        /\bdan juga\b/i,
        /\btidak dapat\b/i
    ];
    if (indonesianMarkers.some((pattern) => pattern.test(message))) {
        throw new McpToolError(
            'INVALID_PAYLOAD',
            'The message appears to be written in Indonesian. Outbound operator messages must be written in Formal English (Rule H).'
        );
    }
}

function resolveTarget(identity: string, input: string): string {
    const trimmed = input.trim();
    if (trimmed.startsWith('contact_ref_')) {
        const resolved = resolveContactRef(trimmed, identity);
        if (!resolved) {
            throw new McpToolError(
                'INVALID_PAYLOAD',
                'The contact_ref alias has expired or was issued to a different identity. Request a fresh target list.'
            );
        }
        return resolved;
    }
    return trimmed;
}

export const registerBotTools: ToolRegistrar = (server, deps, summary) => {
    registerTool(
        server,
        'cosmos_bot_status',
        {
            description:
                'Report live bot engine status: socket connection state, uptime, resident memory, event-loop lag, and the timestamp of the last connection update. Returns BOT_OFFLINE rather than a fabricated success when the engine is unreachable.',
            inputSchema: {},
            handler: async () => {
                const payload = await sendIpcOrThrow<Record<string, unknown>>('/internal/bot/status');
                return {
                    online: payload.online === true,
                    sessions: payload.sessions ?? 0,
                    defaultRegistered: payload.defaultRegistered === true,
                    uptimeSeconds: payload.uptimeSeconds ?? 0,
                    memoryMb: payload.memoryMb ?? 0,
                    eventLoopLagMs: payload.eventLoopLagMs ?? 0,
                    lastConnectionUpdateAt: payload.lastConnectionUpdateAt ?? null,
                    source: 'cosmos-bot-engine'
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_bot_health',
        {
            description:
                'Report the bot engine IPC health probe: whether the socket responds and how many Baileys sessions are registered.',
            inputSchema: {},
            handler: async () => {
                const response = await sendIpcEnvelope<{ ok?: boolean; connections?: number }>('/internal/health');
                if (response.status !== 200) {
                    return {
                        reachable: false,
                        error: (response.data as IpcErrorBody | undefined)?.error ?? 'BOT_OFFLINE',
                        detail: 'The bot engine did not answer the IPC health probe.'
                    };
                }
                return { reachable: true, connections: response.data?.connections ?? 0 };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_bot_groups_list',
        {
            description:
                'List the groups the bot engine can reach: every participating group from the live socket, falling back to the WhitelistedGroup database. JIDs are returned masked together with a server-side contact_ref alias, so you never have to hardcode a group identifier.',
            inputSchema: {
                includeRefs: zod.optionalBoolean('Also return server-side contact_ref aliases. Defaults to true.')
            },
            handler: async (toolArgs, toolDeps) => {
                const payload = await sendIpcOrThrow<{
                    source?: string;
                    groups?: Array<{ jid: string; language?: string }>;
                }>('/internal/groups/all');
                const groups = payload.groups ?? [];
                const includeRefs = toolArgs.includeRefs !== false;
                return {
                    source: payload.source ?? 'unknown',
                    count: groups.length,
                    groups: groups.map((group) => ({
                        jid: maskJid(group.jid),
                        language: group.language ?? null,
                        contactRef: includeRefs ? issueContactRef(group.jid, toolDeps.identity.identity) : undefined
                    })),
                    note: 'Use the contactRef value as the target for cosmos_bot_send_message; the raw JID never leaves the server.'
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_bot_send_message',
        {
            description:
                'Send a text message to an explicit user or group chat through the live bot engine. Dry-run by default. Targets are given either as a contact_ref alias from cosmos_bot_groups_list or as a raw JID; both are resolved server-side and never echoed back.',
            mutating: true,
            inputSchema: {
                target: zod.string('A contact_ref alias or a raw WhatsApp JID.'),
                message: zod.string('The Formal English message body.'),
                dryRun: zod.optionalBoolean('Set false to actually send. Defaults to true.'),
                confirm: zod.optionalBoolean('Required when dryRun is false.')
            },
            handler: async (toolArgs, toolDeps) => {
                const config = loadMcpConfig();
                const message = String(toolArgs.message ?? '').trim();
                if (!message) throw new McpToolError('INVALID_PAYLOAD', 'A message body is required.');
                if (message.length > config.maxOutboundMessageLength) {
                    throw new McpToolError(
                        'INVALID_PAYLOAD',
                        `The message exceeds the ${config.maxOutboundMessageLength} character limit.`
                    );
                }
                assertFormalEnglish(message);

                const jid = resolveTarget(toolDeps.identity.identity, String(toolArgs.target ?? ''));
                const dryRun = toolArgs.dryRun !== false;

                if (dryRun) {
                    return {
                        sent: false,
                        dryRun: true,
                        target: maskJid(jid),
                        messageLength: message.length,
                        note: 'Set dryRun: false together with confirm: true to send this message.'
                    };
                }
                if (toolArgs.confirm !== true) {
                    throw new McpToolError('CONFIRMATION_REQUIRED', 'Sending a live message requires confirm: true.');
                }

                // The engine exposes OTP dispatch over IPC; general sends use the
                // dedicated internal route so no credential is ever proxied.
                await sendIpcOrThrow('/internal/messages/send', { jid, message });

                await recordAudit({
                    identity: toolDeps.identity,
                    tool: 'cosmos_bot_send_message',
                    summary: `Sent a ${message.length} character message to one chat.`
                });

                return { sent: true, dryRun: false, target: maskJid(jid), messageLength: message.length };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_bot_broadcast',
        {
            description:
                'Broadcast a Formal English announcement to WhatsApp groups through the live bot engine. Dry-run by default, returning the resolved target list and the estimated total duration without sending. The fan-out is persisted in the database with a staggered schedule, so a multi-hour run survives a restart, and it can be cancelled. This is the single-call replacement for writing a bespoke broadcast script.',
            mutating: true,
            inputSchema: {
                message: zod.string('The Formal English announcement to deliver.'),
                delayMs: zod.optionalInt(
                    'Delay between consecutive groups. Defaults to 5000 ms, minimum 1000 ms, maximum 3600000 ms.'
                ),
                targetGroups: zod.optionalStringArray(
                    'An explicit list of group JIDs. Omit to target every participating group with the WhitelistedGroup fallback.'
                ),
                dryRun: zod.optionalBoolean('Set false to actually send. Defaults to true.'),
                confirm: zod.optionalBoolean('Required when dryRun is false.'),
                waitMs: zod.optionalInt(
                    'Optionally wait up to this many milliseconds for early delivery receipts before returning.'
                )
            },
            handler: async (toolArgs, toolDeps) => {
                const config = loadMcpConfig();
                const message = String(toolArgs.message ?? '').trim();
                if (!message) throw new McpToolError('INVALID_PAYLOAD', 'A message body is required.');
                if (message.length > config.maxOutboundMessageLength) {
                    throw new McpToolError(
                        'INVALID_PAYLOAD',
                        `The message exceeds the ${config.maxOutboundMessageLength} character limit.`
                    );
                }
                assertFormalEnglish(message);

                const delayMs = numberOr(toolArgs.delayMs, 5000);
                if (delayMs < config.minBroadcastDelayMs || delayMs > config.maxBroadcastDelayMs) {
                    throw new McpToolError(
                        'INVALID_PAYLOAD',
                        `delayMs must be between ${config.minBroadcastDelayMs} and ${config.maxBroadcastDelayMs}.`,
                        { min: config.minBroadcastDelayMs, max: config.maxBroadcastDelayMs }
                    );
                }

                const targetGroups = (toolArgs.targetGroups as string[] | undefined)?.map((entry) =>
                    resolveTarget(toolDeps.identity.identity, entry)
                );
                const dryRun = toolArgs.dryRun !== false;

                if (dryRun) {
                    const preview = await sendIpcOrThrow<{
                        targetCount: number;
                        maskedTargets: string[];
                        source: string;
                        delayMs: number;
                        estimatedDurationMs: number;
                        messageLength: number;
                        note: string;
                    }>('/internal/broadcast/preview', { message, delayMs, targetGroups });

                    if (preview.targetCount > config.maxBroadcastTargets) {
                        throw new McpToolError(
                            'INVALID_PAYLOAD',
                            `The resolved target list has ${preview.targetCount} groups, above the ${config.maxBroadcastTargets} concurrency ceiling. Narrow targetGroups.`,
                            { ceiling: config.maxBroadcastTargets }
                        );
                    }

                    return {
                        sent: false,
                        dryRun: true,
                        ...preview,
                        note: `${preview.note} Set dryRun: false together with confirm: true to schedule this broadcast.`
                    };
                }

                if (toolArgs.confirm !== true) {
                    throw new McpToolError('CONFIRMATION_REQUIRED', 'Sending a live broadcast requires confirm: true.');
                }

                const result = await sendIpcOrThrow<{
                    jobId?: string;
                    queued?: number;
                    source?: string;
                    estimatedDurationMs?: number;
                    count?: number;
                    message?: string;
                }>('/internal/broadcast', {
                    message,
                    delayMs,
                    targetGroups,
                    requestedBy: toolDeps.identity.identity
                });

                if (!result.jobId) {
                    return {
                        sent: false,
                        dryRun: false,
                        queued: result.count ?? 0,
                        reason: result.message ?? 'NO_GROUPS_FOUND'
                    };
                }

                await recordAudit({
                    identity: toolDeps.identity,
                    tool: 'cosmos_bot_broadcast',
                    summary: `Scheduled broadcast ${result.jobId} to ${result.queued} group(s) with a ${delayMs} ms delay.`
                });

                const waitMs = Math.min(10_000, Math.max(0, numberOr(toolArgs.waitMs, 0)));
                if (waitMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, waitMs));
                    const status = await sendIpcEnvelope<{ found?: boolean; job?: unknown }>(
                        '/internal/broadcast/status',
                        {
                            jobId: result.jobId
                        }
                    );
                    if (status.status === 200 && status.data?.found) {
                        return { sent: true, dryRun: false, ...result, job: status.data.job };
                    }
                }

                return {
                    sent: true,
                    dryRun: false,
                    ...result,
                    note: 'The fan-out is persisted. Poll cosmos_bot_broadcast_status with the returned jobId for per-group delivery receipts.'
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_bot_broadcast_status',
        {
            description:
                'Report the delivery receipts of a scheduled broadcast: per-group status, attempt counts, and delivery timestamps. Pass no jobId to list the most recent jobs instead.',
            inputSchema: {
                jobId: zod.optionalString('The broadcast job identifier returned by cosmos_bot_broadcast.'),
                limit: zod.optionalInt('Number of recent jobs to list when no jobId is supplied. Defaults to 10.')
            },
            handler: async (toolArgs) => {
                const jobId = toolArgs.jobId as string | undefined;
                const response = await sendIpcEnvelope<{ found?: boolean; job?: unknown; recentJobs?: unknown[] }>(
                    '/internal/broadcast/status',
                    { jobId: jobId ?? '' }
                );
                if (response.status !== 200) {
                    throw new McpToolError('BOT_OFFLINE', 'The bot engine did not answer the broadcast status query.');
                }
                return {
                    found: response.data?.found === true,
                    job: response.data?.job ?? null,
                    recentJobs: response.data?.recentJobs ?? [],
                    limit: toolArgs.limit ?? 10
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_bot_broadcast_cancel',
        {
            description:
                'Cancel a scheduled broadcast. Every delivery that has not been sent yet is released; deliveries already completed are untouched. Also reachable from WhatsApp through the .cancel command (Rule N).',
            mutating: true,
            inputSchema: {
                jobId: zod.string('The broadcast job identifier returned by cosmos_bot_broadcast.'),
                confirm: zod.boolean('Required: true to acknowledge the cancellation.')
            },
            handler: async (toolArgs) => {
                if (toolArgs.confirm !== true) {
                    throw new McpToolError('CONFIRMATION_REQUIRED', 'Cancelling a broadcast requires confirm: true.');
                }
                const jobId = String(toolArgs.jobId ?? '').trim();
                if (!jobId) throw new McpToolError('INVALID_PAYLOAD', 'A jobId is required.');
                const result = await sendIpcOrThrow<{ cancelled?: boolean }>('/internal/broadcast/cancel', { jobId });
                return { jobId, cancelled: result.cancelled === true };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_bot_reconnect',
        {
            description:
                'Operator-only: force a Baileys session to drop so the supervised reconnect logic rebuilds it. Confirmation-gated and logged. Never exposes credential material.',
            mutating: true,
            inputSchema: {
                sessionId: zod.optionalString('The session identifier. Defaults to "default".'),
                confirm: zod.boolean('Required: true to acknowledge the disconnection.')
            },
            handler: async (toolArgs, toolDeps) => {
                if (toolArgs.confirm !== true) {
                    throw new McpToolError('CONFIRMATION_REQUIRED', 'Forcing a reconnect requires confirm: true.');
                }
                const sessionId = (toolArgs.sessionId as string | undefined) ?? 'default';
                const result = await sendIpcOrThrow<{ reconnected?: boolean; reason?: string }>(
                    '/internal/bot/reconnect',
                    {
                        sessionId,
                        confirm: true
                    }
                );
                await recordAudit({
                    identity: toolDeps.identity,
                    tool: 'cosmos_bot_reconnect',
                    summary: `Forced a reconnect of session ${sessionId}.`
                });
                return { sessionId, reconnected: result.reconnected === true, reason: result.reason ?? null };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_bot_logout',
        {
            description:
                'Operator-only: log a Baileys session out and clear its stored credentials. Irreversible for that session; confirmation-gated, logged, and never returns credential material.',
            mutating: true,
            inputSchema: {
                sessionId: zod.optionalString('The session identifier. Defaults to "default".'),
                confirm: zod.boolean('Required: true. Logging out cannot be undone.')
            },
            handler: async (toolArgs, toolDeps) => {
                if (toolArgs.confirm !== true) {
                    throw new McpToolError('CONFIRMATION_REQUIRED', 'Logging out requires confirm: true.');
                }
                const sessionId = (toolArgs.sessionId as string | undefined) ?? 'default';
                const result = await sendIpcOrThrow<{ loggedOut?: boolean; reason?: string }>('/internal/bot/logout', {
                    sessionId,
                    confirm: true
                });
                await recordAudit({
                    identity: toolDeps.identity,
                    tool: 'cosmos_bot_logout',
                    summary: `Logged out session ${sessionId}.`
                });
                return { sessionId, loggedOut: result.loggedOut === true, reason: result.reason ?? null };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_bot_subbot_list',
        {
            description:
                'Enumerate the registered sub-bot instances and whether each one currently holds a live socket. Pairing codes and QR payloads are generated exclusively inside the engine and are never fabricated here (Rule Y).',
            inputSchema: {},
            handler: async () => {
                const payload = await sendIpcOrThrow<{
                    instances?: Array<{
                        id: string;
                        ownerJid: string;
                        status: string;
                        connected: boolean;
                        createdAt: string;
                    }>;
                }>('/internal/subbots/list');
                return {
                    count: payload.instances?.length ?? 0,
                    instances: (payload.instances ?? []).map((instance) => ({
                        id: maskPhone(instance.id),
                        owner: maskJid(instance.ownerJid),
                        status: instance.status,
                        connected: instance.connected,
                        createdAt: instance.createdAt
                    }))
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_bot_subbot_status',
        {
            description:
                'Report the live pairing state of one sub-bot session. The value is proxied verbatim from the engine; BOT_OFFLINE is returned when the engine is unreachable rather than a fabricated pairing code.',
            inputSchema: {
                phone: zod.string('The sub-bot phone number, digits only.')
            },
            handler: async (toolArgs) => {
                const phone = String(toolArgs.phone ?? '').replace(/\D/g, '');
                if (phone.length < 8)
                    throw new McpToolError('INVALID_PAYLOAD', 'A valid sub-bot phone number is required.');
                const payload = await sendIpcOrThrow<{ state?: unknown }>('/internal/subbots/status', { phone });
                return { phone: maskPhone(phone), state: payload.state ?? null, source: 'cosmos-bot-engine' };
            }
        },
        deps,
        summary
    );
};
