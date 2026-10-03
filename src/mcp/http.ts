/**
 * Cosmos MCP Server — Streamable HTTP transport.
 *
 * Bound to loopback only (AGENTS.md Rule V) and never proxied through the public
 * Nginx listener, so the only way to reach it is from inside the container, an
 * SSH tunnel, or a co-located process. Loopback binding is transport hygiene,
 * NOT an authorisation substitute: every request is still authenticated against
 * the single owner API key with a constant-time comparison, and an
 * unauthenticated request is refused with `401 UNAUTHORIZED_MCP`.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticateOwnerKey, extractTokenFromHeaders, type McpIdentity } from './auth.js';
import { isLoopbackBind, loadMcpConfig } from './config.js';
import { buildMcpServer } from './server.js';

interface Session {
    transport: StreamableHTTPServerTransport;
    /** The authenticated identity bound to this session. */
    identity: McpIdentity;
}

const sessions = new Map<string, Session>();

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
}

/**
 * Starts the Streamable HTTP MCP transport.
 *
 * @throws {Error} When HTTP is enabled but the configured bind address is not
 * loopback. Rule V forbids exposing this surface on a routable interface.
 */
export async function startHttpTransport(): Promise<http.Server> {
    const config = loadMcpConfig();

    if (!isLoopbackBind(config.httpBindHost)) {
        throw new Error(
            `Refusing to bind the Cosmos MCP HTTP transport to ${config.httpBindHost}. Only loopback addresses are permitted (Rule V).`
        );
    }

    const server = http.createServer((req, res) => {
        void handleRequest(req, res).catch((err) => {
            console.error('[MCP] Unhandled HTTP transport error:', err);
            if (!res.headersSent) sendJson(res, 500, { error: 'INTERNAL_ERROR' });
        });
    });

    await new Promise<void>((resolve) => {
        server.listen(config.httpPort, config.httpBindHost, () => {
            resolve();
        });
    });

    const address = server.address() as AddressInfo;
    console.log(
        `[MCP] Streamable HTTP transport listening on http://${config.httpBindHost}:${address.port}/mcp (loopback only).`
    );
    return server;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/healthz') {
        sendJson(res, 200, { status: 'ok', service: 'cosmos-mcp', sessions: sessions.size });
        return;
    }

    if (url.pathname !== '/mcp') {
        sendJson(res, 404, { error: 'NOT_FOUND' });
        return;
    }

    // Fail closed: authenticate every request, including loopback callers.
    let identity: McpIdentity;
    try {
        identity = authenticateOwnerKey(
            extractTokenFromHeaders(req.headers as Record<string, string | string[] | undefined>),
            'http'
        );
    } catch {
        sendJson(res, 401, { error: 'UNAUTHORIZED_MCP' });
        return;
    }

    const sessionId = (req.headers['mcp-session-id'] as string | undefined) ?? url.searchParams.get('sessionId') ?? '';
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (req.method === 'POST' && (!session || !sessionId)) {
        const built = buildMcpServer(identity);
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId: string) => {
                sessions.set(newSessionId, { transport, identity });
                console.log(`[MCP] HTTP session ${newSessionId} opened for ${identity.identity}.`);
            }
        });
        transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await built.server.connect(transport);
        // No third argument: the Node wrapper converts req/res to web-standard
        // objects and reads the body itself. Passing a stream here would be
        // treated as a PRE-PARSED message body (parsedBody) and Zod-validated
        // as the JSON-RPC message, failing every request with
        // "Parse error: Invalid JSON-RPC message".
        await transport.handleRequest(req, res);
        return;
    }

    if (!session) {
        sendJson(res, 400, {
            error: 'UNKNOWN_SESSION',
            message: 'No MCP session is associated with this request. Initialise a new session first.'
        });
        return;
    }

    // No third argument: see the note above. The wrapper reads the body.
    await session.transport.handleRequest(req, res);
}

/** Closes every open HTTP session. Used during shutdown and by tests. */
export async function closeHttpSessions(): Promise<void> {
    for (const session of sessions.values()) {
        try {
            await session.transport.close();
        } catch (err) {
            console.error('[MCP] Failed to close an HTTP session:', err);
        }
    }
    sessions.clear();
}

/** Exposed for assertions: the set of authenticated HTTP session identities. */
export function getHttpSessionIdentities(): McpIdentity[] {
    return [...sessions.values()].map((session) => session.identity);
}
