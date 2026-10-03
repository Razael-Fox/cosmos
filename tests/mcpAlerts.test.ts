/**
 * MCP Alert Notifier — tests.
 *
 * Covers three layers:
 *  1. The pure request validator shared by the IPC route.
 *  2. The rolling authentication-rejection threshold counter.
 *  3. The end-to-end MCP side: alerts must reach the IPC
 *     bridge as well-formed requests, must never throw into
 *     tool handlers, and must degrade silently when the
 *     bot engine is unreachable.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The alert path imports the IPC client and the Prisma client,
// so the suite runs against a dedicated scratch database.
const SCRATCH_DB = path.join(REPO_ROOT, 'storage', 'cosmos-mcp-alerts-test.sqlite');

process.env.COSMOS_MCP_TOKEN = 'unit-test-owner-key-0123456789';
process.env.INTERNAL_IPC_SECRET = 'unit-test-ipc-secret';
process.env.DATABASE_URL = `file:${SCRATCH_DB}`;

const { MCP_NOTIFY_EVENTS, parseMcpAlertRequest } = await import('../src/services/statusNotifier/mcpAlert.js');
const { NOTIFY_EVENTS, NOTIFY_SEVERITIES } = await import('../src/services/statusNotifier/types.js');
const { getEventTitle } = await import('../src/services/statusNotifier/formatters.js');
const {
    alertAuthRejected,
    alertEngineUnreachable,
    alertMcp,
    alertMutationApplied,
    alertOnToolError,
    resetAuthRejectionTrackerForTest,
    recordAuthRejection,
    setAuthRejectionClockForTest
} = await import('../src/mcp/alerts.js');

/** Captures every request the MCP alert sender puts on the wire. */
interface MockIpc {
    requests: Array<{ path: string; secret?: string; body: Record<string, unknown> }>;
    server: net.Server;
    socketPath: string;
}

function startMockIpc(): MockIpc {
    const requests: MockIpc['requests'] = [];
    const socketPath = path.join(os.tmpdir(), `mcp-alerts-test-${process.pid}-${Date.now()}.sock`);
    const server = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            const newline = buffer.indexOf('\n');
            if (newline === -1) return;
            try {
                const request = JSON.parse(buffer.slice(0, newline)) as MockIpc['requests'][number];
                requests.push(request);
                socket.write(`${JSON.stringify({ status: 200, data: { ok: true } })}\n`);
            } catch {
                socket.write(`${JSON.stringify({ status: 400, data: { error: 'MALFORMED_IPC_REQUEST' } })}\n`);
            }
            socket.end();
            buffer = '';
        });
    });
    server.listen(socketPath);
    return { requests, server, socketPath };
}

/** Waits until the mock has captured `count` requests. */
async function waitForRequests(mock: MockIpc, count: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (mock.requests.length < count) {
        if (Date.now() > deadline) {
            assert.fail(`timed out waiting for ${count} IPC request(s); got ${mock.requests.length}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

describe('mcp alerts: request validation', () => {
    const base = {
        event: 'MCP_TOOL_ERROR',
        severity: 'WARN',
        summary: 'MCP tool cosmos_db_query failed with INVALID_SQL.'
    };

    it('accepts a well-formed alert', () => {
        const result = parseMcpAlertRequest({
            ...base,
            details: ['The query was rejected by the guardrails.'],
            fields: { Tool: 'cosmos_db_query', 'Error Code': 'INVALID_SQL' },
            dedupeKey: 'MCP_TOOL_ERROR:INVALID_SQL',
            dedupeWindowMs: 600_000
        });
        assert.strictEqual(result.ok, true);
        if (!result.ok) return;
        assert.strictEqual(result.request.event, 'MCP_TOOL_ERROR');
        assert.strictEqual(result.request.severity, 'WARN');
        assert.strictEqual(result.request.payload.sessionId, 'mcp');
        assert.strictEqual(result.request.options.dedupeKey, 'MCP_TOOL_ERROR:INVALID_SQL');
    });

    it('rejects events outside the MCP namespace', () => {
        const result = parseMcpAlertRequest({ ...base, event: 'BOT_DOWN' });
        assert.strictEqual(result.ok, false);
        if (result.ok === false) assert.match(result.reason, /event must be one of/);
    });

    it('rejects unknown MCP events', () => {
        const result = parseMcpAlertRequest({ ...base, event: 'MCP_SOMETHING_ELSE' });
        assert.strictEqual(result.ok, false);
    });

    it('rejects invalid severities', () => {
        const result = parseMcpAlertRequest({ ...base, severity: 'EMERGENCY' });
        assert.strictEqual(result.ok, false);
        if (result.ok === false) assert.match(result.reason, /severity must be one of/);
    });

    it('requires a non-empty summary', () => {
        assert.strictEqual(parseMcpAlertRequest({ ...base, summary: '' }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ ...base, summary: '   ' }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ event: 'MCP_TOOL_ERROR', severity: 'WARN' }).ok, false);
    });

    it('enforces the length caps', () => {
        assert.strictEqual(parseMcpAlertRequest({ ...base, summary: 'x'.repeat(201) }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ ...base, details: new Array(11).fill('line') }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ ...base, details: ['x'.repeat(501)] }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ ...base, fields: { ['k'.repeat(41)]: 'v' } }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ ...base, fields: { k: 'v'.repeat(501) } }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ ...base, dedupeKey: 'd'.repeat(121) }).ok, false);
    });

    it('rejects non-scalar field values and malformed shapes', () => {
        assert.strictEqual(parseMcpAlertRequest({ ...base, fields: { k: { nested: true } } }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ ...base, fields: { k: ['a'] } }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ ...base, fields: 'not-an-object' }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ ...base, details: 'not-an-array' }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ ...base, details: [42] }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ ...base, dedupeWindowMs: -1 }).ok, false);
        assert.strictEqual(parseMcpAlertRequest({ ...base, dedupeWindowMs: 'soon' }).ok, false);
    });
});

describe('mcp alerts: event registry', () => {
    it('registers every MCP event in the dispatcher union', () => {
        for (const event of MCP_NOTIFY_EVENTS) {
            assert.ok(
                (NOTIFY_EVENTS as readonly string[]).includes(event),
                `${event} missing from NOTIFY_EVENTS; outbox retries would terminally fail`
            );
        }
    });

    it('renders a real title for every MCP event', () => {
        for (const event of MCP_NOTIFY_EVENTS) {
            const title = getEventTitle(event);
            assert.ok(title && title !== event, `${event} has no EVENT_TITLES entry`);
        }
    });

    it('only uses known severities', () => {
        // Every emit site in src/mcp/alerts.ts must use one of these.
        assert.deepStrictEqual([...NOTIFY_SEVERITIES], ['INFO', 'WARN', 'CRITICAL']);
    });
});

describe('mcp alerts: authentication rejection threshold', () => {
    after(() => resetAuthRejectionTrackerForTest());

    it('stays quiet below the threshold and fires on the third rejection', () => {
        const fakeNow = 1_000_000;
        setAuthRejectionClockForTest(() => fakeNow);

        assert.strictEqual(recordAuthRejection(), false, 'first rejection must not alert');
        assert.strictEqual(recordAuthRejection(), false, 'second rejection must not alert');
        assert.strictEqual(recordAuthRejection(), true, 'third rejection within the window must alert');
    });

    it('re-arms after firing, so a fresh burst is required', () => {
        const fakeNow = 2_000_000;
        setAuthRejectionClockForTest(() => fakeNow);
        recordAuthRejection();
        recordAuthRejection();
        assert.strictEqual(recordAuthRejection(), true);
        // Window was re-armed: the next single rejection must not alert.
        assert.strictEqual(recordAuthRejection(), false);
    });

    it('ignores rejections that aged out of the rolling window', () => {
        let fakeNow = 3_000_000;
        setAuthRejectionClockForTest(() => fakeNow);
        recordAuthRejection();
        recordAuthRejection();
        // Advance beyond the 5-minute window: the old entries expire.
        fakeNow += 5 * 60_000 + 1_000;
        assert.strictEqual(recordAuthRejection(), false);
        assert.strictEqual(recordAuthRejection(), false);
        // A fresh burst still alerts.
        assert.strictEqual(recordAuthRejection(), true);
    });
});

describe('mcp alerts: IPC forwarding', () => {
    let mock: MockIpc;
    const previousSocket = process.env.BOT_IPC_SOCKET;

    before(() => {
        mock = startMockIpc();
        process.env.BOT_IPC_SOCKET = mock.socketPath;
    });

    after(() => {
        if (previousSocket === undefined) delete process.env.BOT_IPC_SOCKET;
        else process.env.BOT_IPC_SOCKET = previousSocket;
        mock.server.close();
        fs.rmSync(mock.socketPath, { force: true });
    });

    it('forwards a generic alert as a well-formed IPC request', async () => {
        await alertMcp('MCP_TOOL_ERROR', 'WARN', 'Tool failed.', {
            details: ['Detail line.'],
            fields: { Tool: 'cosmos_db_query' },
            dedupeKey: 'MCP_TOOL_ERROR:INVALID_SQL',
            dedupeWindowMs: 60_000
        });
        await waitForRequests(mock, 1);
        const [request] = mock.requests;
        assert.strictEqual(request.path, '/internal/mcp/alert');
        assert.strictEqual(request.secret, process.env.INTERNAL_IPC_SECRET);
        assert.strictEqual(request.body.event, 'MCP_TOOL_ERROR');
        assert.strictEqual(request.body.severity, 'WARN');
        assert.strictEqual(request.body.summary, 'Tool failed.');
        assert.deepStrictEqual(request.body.fields, { Tool: 'cosmos_db_query' });
        // The request must survive the route's own validator.
        assert.strictEqual(parseMcpAlertRequest(request.body).ok, true);
    });

    it('classifies tool errors into the right alert events', async () => {
        const baseline = mock.requests.length;
        alertOnToolError('cosmos_db_query', 'RATE_LIMITED', 'Call limit reached.');
        alertOnToolError('cosmos_db_apply_mutation', 'UNSAFE_MUTATION', 'Unsafe write refused.');
        alertOnToolError('cosmos_db_apply_mutation', 'UNKNOWN_FIELD', 'Unknown column.');
        alertOnToolError('cosmos_db_query', 'INVALID_SQL', 'Bad query.');
        await waitForRequests(mock, baseline + 4);

        const events = mock.requests.slice(baseline).map((r) => r.body.event);
        assert.deepStrictEqual(events, [
            'MCP_RATE_LIMITED',
            'MCP_MUTATION_BLOCKED',
            'MCP_MUTATION_BLOCKED',
            'MCP_TOOL_ERROR'
        ]);
    });

    it('reports applied mutations, engine outages, and startup', async () => {
        const baseline = mock.requests.length;
        alertMutationApplied('update', 'User', 2);
        alertEngineUnreachable('/internal/bot/status');
        alertAuthRejected('http', 3);
        await waitForRequests(mock, baseline + 3);

        const events = mock.requests.slice(baseline).map((r) => r.body.event);
        assert.deepStrictEqual(events, ['MCP_MUTATION_APPLIED', 'MCP_ENGINE_UNREACHABLE', 'MCP_AUTH_REJECTED']);
    });

    it('never throws when the bot engine is unreachable', async () => {
        const deadPath = path.join(os.tmpdir(), `mcp-alerts-dead-${Date.now()}.sock`);
        const previousDead = process.env.BOT_IPC_SOCKET;
        process.env.BOT_IPC_SOCKET = deadPath;
        try {
            await assert.doesNotReject(
                alertMcp('MCP_TOOL_ERROR', 'WARN', 'Dropped alert.'),
                'alertMcp must swallow IPC failures'
            );
        } finally {
            process.env.BOT_IPC_SOCKET = previousDead ?? mock.socketPath;
        }
    });
});
