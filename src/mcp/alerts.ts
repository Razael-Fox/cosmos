/**
 * Cosmos MCP Server — alert notifier.
 *
 * Emits sanitized operational and security alerts for the MCP
 * surface. Alerts are forwarded over the authenticated IPC bridge
 * to the bot process, which dispatches them through the regular
 * status-notification fan-out (Discord, Slack, WhatsApp) and
 * persists them to `StatusNotificationLog` with outbox retry.
 *
 * Two invariants govern every function here:
 *  1. Alerting must never fail a tool call — every path is
 *     fire-and-forget and swallows its own errors.
 *  2. Payloads carry only sanitized, low-cardinality fields
 *     (tool names, error codes, transport, row counts). No
 *     credentials, JIDs, phone numbers, or tool arguments
 *     (Rule AG — zero-knowledge outbound).
 */
import { sendIpcCommand } from '#services/ipcServer.js';
import { formatVersion, getVersionInfo } from '#utils/versioning.js';
import type { McpNotifyEvent } from '#services/statusNotifier/mcpAlert.js';
import type { NotifySeverity } from '#services/statusNotifier/types.js';

/** Path of the IPC route that dispatches MCP alerts in the bot process. */
const ALERT_IPC_PATH = '/internal/mcp/alert';

/** Dedupe windows (milliseconds) per alert class. */
const DEDUPE_WINDOWS = {
    serverStarted: 60 * 60_000,
    authRejected: 15 * 60_000,
    rateLimited: 10 * 60_000,
    mutationBlocked: 10 * 60_000,
    toolError: 10 * 60_000,
    engineUnreachable: 15 * 60_000
} as const;

/** Timestamp of the last IPC-failure warning, to avoid log floods. */
let lastIpcFailureWarnAt = 0;
const IPC_FAILURE_WARN_INTERVAL_MS = 60_000;

/**
 * Forwards one alert to the bot process.
 *
 * Never throws: an unreachable bridge logs a deduped warning and
 * drops the alert. The MCP server must stay responsive even when
 * the bot engine is down — that condition is itself reported as
 * `MCP_ENGINE_UNREACHABLE` by the bridge hook.
 */
export async function alertMcp(
    event: McpNotifyEvent,
    severity: NotifySeverity,
    summary: string,
    extras: {
        details?: string[];
        fields?: Record<string, string | number | boolean | null | undefined>;
        dedupeKey?: string;
        dedupeWindowMs?: number;
    } = {}
): Promise<void> {
    try {
        await sendIpcCommand(ALERT_IPC_PATH, {
            event,
            severity,
            summary,
            ...(extras.details ? { details: extras.details } : {}),
            ...(extras.fields ? { fields: extras.fields } : {}),
            ...(extras.dedupeKey ? { dedupeKey: extras.dedupeKey } : {}),
            ...(extras.dedupeWindowMs !== undefined ? { dedupeWindowMs: extras.dedupeWindowMs } : {})
        });
    } catch {
        const now = Date.now();
        if (now - lastIpcFailureWarnAt >= IPC_FAILURE_WARN_INTERVAL_MS) {
            lastIpcFailureWarnAt = now;
            console.warn('[MCP] Alert notifier: IPC bridge unreachable; alert dropped (%s).', event);
        }
    }
}

/**
 * Reports that the MCP server finished starting on its transport.
 * Called once at boot, after the transport is ready.
 */
export function alertServerStarted(transport: string): void {
    void alertMcp('MCP_SERVER_STARTED', 'INFO', `Cosmos MCP server is ready on the ${transport} transport.`, {
        fields: {
            Transport: transport,
            Version: formatVersion(getVersionInfo())
        },
        dedupeKey: 'MCP_SERVER_STARTED',
        dedupeWindowMs: DEDUPE_WINDOWS.serverStarted
    });
}

/**
 * Reports that the IPC bridge to the bot engine failed at the
 * transport layer. Emitted by the bridge itself so every tool that
 * depends on live engine data benefits from the signal.
 */
export function alertEngineUnreachable(path: string): void {
    void alertMcp(
        'MCP_ENGINE_UNREACHABLE',
        'CRITICAL',
        'The Cosmos bot engine is unreachable over the IPC socket. Live-data MCP tools will return BOT_OFFLINE.',
        {
            details: ['Check that the bot process is running and the IPC socket exists.'],
            fields: { IpcPath: path },
            dedupeKey: 'MCP_ENGINE_UNREACHABLE',
            dedupeWindowMs: DEDUPE_WINDOWS.engineUnreachable
        }
    );
}

/** Authentication-rejection rolling window. */
const AUTH_REJECT_WINDOW_MS = 5 * 60_000;
export const AUTH_REJECT_THRESHOLD = 3;

let rejectionTimestamps: number[] = [];
let rejectionClock: () => number = () => Date.now();

/** Test seam: replaces the wall clock and clears the rejection window. */
export function setAuthRejectionClockForTest(now: () => number): void {
    rejectionClock = now;
    rejectionTimestamps = [];
}

/** Test seam: restores the wall clock and clears the rejection window. */
export function resetAuthRejectionTrackerForTest(): void {
    rejectionClock = () => Date.now();
    rejectionTimestamps = [];
}

/**
 * Records one rejected authentication attempt against a rolling
 * 5-minute window. Returns `true` when the burst reaches the
 * threshold — the caller should then emit `MCP_AUTH_REJECTED` —
 * and re-arms the window so the next alert requires a fresh burst.
 */
export function recordAuthRejection(): boolean {
    const now = rejectionClock();
    rejectionTimestamps = rejectionTimestamps.filter((at) => now - at <= AUTH_REJECT_WINDOW_MS);
    rejectionTimestamps.push(now);
    if (rejectionTimestamps.length >= AUTH_REJECT_THRESHOLD) {
        rejectionTimestamps = [];
        return true;
    }
    return false;
}

/**
 * Reports a burst of rejected unauthenticated requests. A short
 * burst is normal probing; a sustained burst is a brute-force
 * signal against the single owner key.
 */
export function alertAuthRejected(transport: string, rejectedInWindow: number): void {
    void alertMcp(
        'MCP_AUTH_REJECTED',
        'CRITICAL',
        `${rejectedInWindow} unauthenticated MCP requests were rejected on the ${transport} transport within 5 minutes.`,
        {
            details: [
                'Sustained rejection bursts can indicate a brute-force attempt against the owner key.',
                'Rotate COSMOS_MCP_TOKEN in the secret manager if this was not you.'
            ],
            fields: { Transport: transport, 'Rejected (5 min)': rejectedInWindow },
            dedupeKey: 'MCP_AUTH_REJECTED',
            dedupeWindowMs: DEDUPE_WINDOWS.authRejected
        }
    );
}

/** Tool error codes that represent a safety gate refusing work. */
const BLOCKED_MUTATION_CODES = new Set(['UNSAFE_MUTATION', 'UNKNOWN_FIELD', 'PLAN_REQUIRED', 'CONFIRMATION_REQUIRED']);

/**
 * Classifies a failed tool invocation and emits the matching alert:
 * rate limits, safety-gate rejections, and unexpected tool errors
 * are tracked separately so an operator can tell a probe from a
 * malfunction.
 */
export function alertOnToolError(tool: string, errorCode: string, message: string): void {
    if (errorCode === 'RATE_LIMITED') {
        void alertMcp('MCP_RATE_LIMITED', 'WARN', `MCP tool ${tool} was rate limited (${message}).`, {
            fields: { Tool: tool, 'Error Code': errorCode },
            dedupeKey: `MCP_RATE_LIMITED:${errorCode}`,
            dedupeWindowMs: DEDUPE_WINDOWS.rateLimited
        });
        return;
    }
    if (BLOCKED_MUTATION_CODES.has(errorCode)) {
        void alertMcp('MCP_MUTATION_BLOCKED', 'WARN', `MCP safety gate blocked ${tool} with ${errorCode}.`, {
            details: [message],
            fields: { Tool: tool, 'Error Code': errorCode },
            dedupeKey: `MCP_MUTATION_BLOCKED:${errorCode}:${tool}`,
            dedupeWindowMs: DEDUPE_WINDOWS.mutationBlocked
        });
        return;
    }
    void alertMcp('MCP_TOOL_ERROR', 'WARN', `MCP tool ${tool} failed with ${errorCode}.`, {
        details: [message],
        fields: { Tool: tool, 'Error Code': errorCode },
        dedupeKey: `MCP_TOOL_ERROR:${errorCode}`,
        dedupeWindowMs: DEDUPE_WINDOWS.toolError
    });
}

/**
 * Reports an executed database mutation for the audit trail.
 * INFO severity: filtered from channels by the default
 * `STATUS_NOTIFY_MIN_SEVERITY=WARN`, but always persisted to
 * `StatusNotificationLog`.
 */
export function alertMutationApplied(operation: string, model: string, affectedRows: number): void {
    void alertMcp(
        'MCP_MUTATION_APPLIED',
        'INFO',
        `MCP applied ${operation} on ${model} affecting ${affectedRows} row(s).`,
        {
            fields: { Operation: operation, Model: model, 'Rows Affected': affectedRows }
        }
    );
}
