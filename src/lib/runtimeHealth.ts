/**
 * Runtime health probes shared by the Baileys connection lifecycle and the
 * `/internal/bot/status` IPC route (and, in turn, the Cosmos MCP
 * `cosmos_bot_status` tool).
 *
 * Kept dependency-free on purpose: `connectionManager.ts` and `ipcServer.ts`
 * already import each other, so a third module is the only way to share state
 * without introducing an import cycle.
 */

let lastConnectionUpdateAt: string | null = null;
let lastEventLoopProbe = Date.now();
let eventLoopLagMs = 0;

const probe = setInterval(() => {
    const now = Date.now();
    eventLoopLagMs = Math.max(0, now - lastEventLoopProbe - 1000);
    lastEventLoopProbe = now;
}, 1000);
probe.unref?.();

/** Records the timestamp of the most recent Baileys `connection.update` event. */
export function noteConnectionUpdate(): void {
    lastConnectionUpdateAt = new Date().toISOString();
}

/** ISO timestamp of the most recent `connection.update`, or `null`. */
export function getLastConnectionUpdateAt(): string | null {
    return lastConnectionUpdateAt;
}

/** Most recent event-loop lag sample in milliseconds. */
export function getEventLoopLagMs(): number {
    return eventLoopLagMs;
}

/** Process uptime in whole seconds. */
export function getUptimeSeconds(): number {
    return Math.floor(process.uptime());
}

/** Resident set size in megabytes. */
export function getMemoryMb(): number {
    return Math.round(process.memoryUsage().rss / 1024 / 1024);
}
