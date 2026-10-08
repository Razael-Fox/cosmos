/**
 * Cosmos MCP Server — entrypoint.
 *
 * Usage:
 *   node dist/mcp/index.js                 # stdio transport (default)
 *   node dist/mcp/index.js --transport=http
 *
 * Both transports authenticate against the single owner API key in
 * `COSMOS_MCP_TOKEN` (issue #49). The server FAILS CLOSED: when the key is
 * missing or empty it refuses to start rather than serving anonymous access.
 *
 * The stdio transport has no per-request header, so its authorisation model is
 * "the process was started with the owner's secret in its environment". Use the
 * HTTP transport (over an SSH tunnel) from any other machine.
 */
import { authenticateOwnerKey } from './auth.js';
import { isOwnerKeyConfigured } from './config.js';

type Transport = 'stdio' | 'http';

/**
 * Resolves the transport from CLI arguments.
 *
 * Both spellings are accepted: `--transport http` (two argv entries) and
 * `--transport=http` (one). The equals form is what PM2 passes when
 * `ecosystem.config.cjs` declares `args: '--transport=http'`, and it is a
 * single argv string, so an `indexOf('--transport')` lookup misses it entirely.
 * That mistake shipped the server silently running on stdio under PM2 while the
 * process still reported `online`, serving nothing on its HTTP port.
 */
export function parseTransport(argv: string[]): Transport {
    const inline = argv.find((arg) => arg.startsWith('--transport='));
    if (inline) {
        const value = inline.slice('--transport='.length);
        if (value === 'http' || value === 'stdio') return value;
        throw new Error(`Unsupported transport "${value}". Use "stdio" or "http".`);
    }

    const flagIndex = argv.indexOf('--transport');
    if (flagIndex !== -1) {
        const value = argv[flagIndex + 1];
        if (value === 'http' || value === 'stdio') return value;
        if (value === undefined) throw new Error('Missing value for --transport. Use "stdio" or "http".');
        throw new Error(`Unsupported transport "${value}". Use "stdio" or "http".`);
    }

    if (argv.includes('--http')) return 'http';
    return 'stdio';
}

async function main(): Promise<void> {
    const transport = parseTransport(process.argv.slice(2));

    // Fail closed before anything is registered or bound.
    if (!isOwnerKeyConfigured()) {
        console.error(
            '[MCP] Refusing to start: COSMOS_MCP_TOKEN is not configured. The Cosmos MCP server has no owner API key, so no request can be authorised. Set the key in the secret manager and restart.'
        );
        process.exitCode = 78; // EX_CONFIG
        return;
    }

    const version = (await import('#lib/versioning.js')).getVersionInfo().version;
    console.log(`[MCP] Cosmos MCP server ${version} starting on the ${transport} transport.`);

    // Status-channel alert: the server is up and serving. Fire-and-forget;
    // the bot process may still be starting alongside us under PM2.
    const { alertServerStarted } = await import('./alerts.js');
    alertServerStarted(transport);

    if (transport === 'http') {
        const { startHttpTransport } = await import('./http.js');
        const server = await startHttpTransport();
        const shutdown = async (signal: string) => {
            console.log(`[MCP] Received ${signal}; shutting the HTTP transport down.`);
            const { closeHttpSessions } = await import('./http.js');
            // Bound the graceful phase. If session cleanup hangs, exit
            // anyway: PM2 escalates to SIGKILL when a process ignores
            // SIGTERM, and a SIGKILLed process can leave the port
            // held, crashing the replacement into EADDRINUSE. Exiting
            // on our own terms releases the port.
            const forceExit = setTimeout(() => process.exit(0), 5_000);
            forceExit.unref();
            await closeHttpSessions();
            clearTimeout(forceExit);
            server.close(() => process.exit(0));
        };
        process.on('SIGINT', () => void shutdown('SIGINT'));
        process.on('SIGTERM', () => void shutdown('SIGTERM'));
        return;
    }

    // stdio: the owner's key must already be present in this process' environment.
    const identity = authenticateOwnerKey(process.env.COSMOS_MCP_TOKEN, 'stdio');
    const { buildMcpServer } = await import('./server.js');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { server: mcp } = buildMcpServer(identity);
    const stdio = new StdioServerTransport();
    await mcp.connect(stdio);
    console.log('[MCP] stdio transport ready.');
}

/**
 * Detects whether this module is the process entrypoint.
 *
 * Direct execution puts the module path in `argv[1]`. PM2's fork mode does
 * not: PM2 runs its own `ProcessContainerFork.js` as `argv[1]` and exposes
 * the real script path through the `pm_exec_path` environment variable.
 * Without the second check the server never starts under PM2 — the module
 * loads, `main()` is skipped, the event loop drains, Node exits cleanly
 * with code 0, and PM2 restart-loops a process that looks healthy while
 * serving nothing.
 */
export function isProcessEntrypoint(): boolean {
    const candidates = [process.argv[1], process.env.pm_exec_path];
    return candidates.some((candidate) => !!candidate && /mcp[/\\]index\.(js|ts|mjs|cjs)$/.test(candidate));
}

// Only auto-start when executed as the entrypoint. Importing this module (as the
// regression suite does, to exercise `parseTransport`) must not boot a server.
if (isProcessEntrypoint()) {
    main().catch((err) => {
        console.error('[MCP] Fatal start-up error:', err);
        process.exitCode = 1;
    });
}
