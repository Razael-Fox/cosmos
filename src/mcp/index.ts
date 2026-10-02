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

function parseTransport(argv: string[]): Transport {
    const flagIndex = argv.indexOf('--transport');
    if (flagIndex !== -1 && argv[flagIndex + 1]) {
        const value = argv[flagIndex + 1];
        if (value === 'http' || value === 'stdio') return value;
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

    const version = (await import('#utils/versioning.js')).getVersionInfo().version;
    console.log(`[MCP] Cosmos MCP server ${version} starting on the ${transport} transport.`);

    if (transport === 'http') {
        const { startHttpTransport } = await import('./http.js');
        const server = await startHttpTransport();
        const shutdown = async (signal: string) => {
            console.log(`[MCP] Received ${signal}; shutting the HTTP transport down.`);
            const { closeHttpSessions } = await import('./http.js');
            await closeHttpSessions();
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

main().catch((err) => {
    console.error('[MCP] Fatal start-up error:', err);
    process.exitCode = 1;
});
