/**
 * End-to-end smoke check for the Cosmos MCP server.
 *
 * Speaks the real MCP stdio protocol against the real server process, exactly as
 * a coding-agent client would. Verifies that:
 *  - the server refuses to start without an owner key (fail closed),
 *  - an authorised client can list tools and exercise the guarded surface,
 *  - a live bot action returns BOT_OFFLINE rather than a fabricated success.
 *
 * Run with: node tests/smoke/cosmosMcpSmoke.mjs
 */
import assert from 'node:assert';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRATCH_DB = path.join(REPO_ROOT, 'storage', 'cosmos-mcp-smoke.sqlite');
const OWNER_KEY = 'smoke-test-owner-key-0123456789';

function startServer(env) {
    return spawn(
        process.execPath,
        [path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/mcp/index.ts'],
        {
            cwd: REPO_ROOT,
            env: { ...process.env, ...env },
            stdio: ['pipe', 'pipe', 'pipe']
        }
    );
}

class McpStdioClient {
    constructor(child) {
        this.child = child;
        this.buffer = '';
        this.pending = new Map();
        this.nextId = 1;

        child.stdout.on('data', (chunk) => {
            this.buffer += chunk.toString('utf8');
            let index = this.buffer.indexOf('\n');
            while (index !== -1) {
                const line = this.buffer.slice(0, index).trim();
                this.buffer = this.buffer.slice(index + 1);
                index = this.buffer.indexOf('\n');
                if (!line) continue;
                try {
                    const message = JSON.parse(line);
                    const resolve = this.pending.get(message.id);
                    if (resolve) {
                        this.pending.delete(message.id);
                        resolve(message);
                    }
                } catch {
                    /* ignore non-JSON noise */
                }
            }
        });
    }

    request(method, params = {}, timeoutMs = 90_000) {
        const id = this.nextId++;
        const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`MCP request timed out: ${method}`));
            }, timeoutMs);
            this.pending.set(id, (value) => {
                clearTimeout(timer);
                resolve(value);
            });
            this.child.stdin.write(payload);
        });
    }

    notify(method, params = {}) {
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    }

    async initialize() {
        const result = await this.request('initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'cosmos-mcp-smoke', version: '1.0.0' }
        });
        this.notify('notifications/initialized');
        return result;
    }

    callTool(name, args = {}) {
        return this.request('tools/call', { name, arguments: args });
    }
}

function parseToolResult(response) {
    assert.ok(response?.result?.content?.[0]?.text, `no tool content in: ${JSON.stringify(response).slice(0, 400)}`);
    return JSON.parse(response.result.content[0].text);
}

async function main() {
    let failures = 0;
    const check = (label, condition, detail = '') => {
        if (condition) {
            console.log(`  PASS  ${label}`);
        } else {
            failures += 1;
            console.error(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
        }
    };

    // ---------------------------------------------------------------- fail closed
    console.log('\n[1] Server refuses to start without an owner key');
    {
        const child = startServer({ COSMOS_MCP_TOKEN: '', DATABASE_URL: `file:${SCRATCH_DB}` });
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        const code = await new Promise((resolve) => child.on('close', resolve));
        check('exits non-zero when COSMOS_MCP_TOKEN is empty', code !== 0, `exit code ${code}`);
        check('explains the fail-closed policy', stderr.includes('Refusing to start'), stderr.slice(0, 200));
    }

    // -------------------------------------------------------------- authorised
    console.log('\n[2] Authorised stdio session');
    const child = startServer({ COSMOS_MCP_TOKEN: OWNER_KEY, DATABASE_URL: `file:${SCRATCH_DB}` });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
    });

    try {
        const client = new McpStdioClient(child);
        const init = await client.initialize();
        check(
            'initialize returns server info',
            init?.result?.serverInfo?.name === 'cosmos-mcp',
            JSON.stringify(init).slice(0, 200)
        );
        check(
            'server instructions carry the agent contract',
            String(init?.result?.instructions ?? '').includes('Cosmos MCP tools')
        );

        const tools = await client.request('tools/list');
        const names = (tools?.result?.tools ?? []).map((tool) => tool.name);
        check(
            'tools/list returns the documented surface',
            names.includes('cosmos_db_describe') && names.includes('cosmos_bot_broadcast'),
            names.join(',')
        );

        const guidance = parseToolResult(await client.callTool('cosmos_guidance'));
        check(
            'guidance states the prohibition on npm',
            guidance.prohibitions.some((entry) => entry.includes('npm'))
        );
        check(
            'guidance maps broadcast intent to cosmos_bot_broadcast',
            guidance.toolSelection.some((entry) => entry.intent.includes('broadcast'))
        );

        const describe = parseToolResult(await client.callTool('cosmos_db_describe'));
        check(
            'db_describe returns the live model count',
            describe.modelCount >= 30,
            `modelCount=${describe.modelCount}`
        );
        check(
            'db_describe names the credential denylist',
            describe.accessPolicy.credentialTablesRefused.includes('WhatsAppAuth')
        );

        const denied = parseToolResult(
            await client.callTool('cosmos_db_query', { sql: 'SELECT id FROM "WhatsAppAuth" LIMIT 1' })
        );
        check(
            'db_query refuses the WhatsAppAuth table',
            denied.error === 'FORBIDDEN_TABLE',
            JSON.stringify(denied).slice(0, 200)
        );

        const noLimit = parseToolResult(
            await client.callTool('cosmos_db_query', { sql: 'SELECT jid FROM "WhitelistedGroup"' })
        );
        check(
            'db_query refuses a statement without LIMIT',
            noLimit.error === 'INVALID_SQL',
            JSON.stringify(noLimit).slice(0, 200)
        );

        const writeAttempt = parseToolResult(
            await client.callTool('cosmos_db_query', { sql: 'DELETE FROM "WhitelistedGroup" LIMIT 1' })
        );
        check(
            'db_query refuses a write verb',
            writeAttempt.error === 'FORBIDDEN_SQL',
            JSON.stringify(writeAttempt).slice(0, 200)
        );

        const plan = parseToolResult(
            await client.callTool('cosmos_db_mutation_plan', {
                model: 'GroupNsfwSetting',
                operation: 'update',
                set: { enabled: true },
                where: { jid: '120363000000000000@g.us' }
            })
        );
        check('mutation_plan accepts a real column', plan.safe === true, JSON.stringify(plan).slice(0, 300));
        check(
            'mutation_plan returns a fingerprint',
            typeof plan.planFingerprint === 'string' && plan.planFingerprint.length > 10
        );
        check('mutation_plan emits $transaction boilerplate', plan.transactionSnippet.includes('prisma.$transaction'));

        const hallucinated = parseToolResult(
            await client.callTool('cosmos_db_mutation_plan', {
                model: 'GroupNsfwSetting',
                operation: 'update',
                set: { enabld: true },
                where: { jid: '1' }
            })
        );
        check(
            'mutation_plan refuses a hallucinated column',
            hallucinated.safe === false,
            JSON.stringify(hallucinated).slice(0, 200)
        );

        const apply = parseToolResult(
            await client.callTool('cosmos_db_apply_mutation', {
                model: 'GroupNsfwSetting',
                operation: 'update',
                set: { enabled: true },
                where: { jid: '120363000000000000@g.us' },
                planFingerprint: 'plan_fingerprint_from_a_different_request'
            })
        );
        check(
            'apply_mutation refuses a fingerprint from a different request',
            apply.error === 'PLAN_REQUIRED',
            JSON.stringify(apply).slice(0, 200)
        );

        const deletePlan = parseToolResult(
            await client.callTool('cosmos_db_mutation_plan', {
                model: 'GroupNsfwSetting',
                operation: 'delete',
                where: { jid: '120363000000000000@g.us' }
            })
        );
        check(
            'mutation_plan marks a delete as destructive',
            deletePlan.destructive === true && deletePlan.safe === true
        );
        const destructiveApply = parseToolResult(
            await client.callTool('cosmos_db_apply_mutation', {
                model: 'GroupNsfwSetting',
                operation: 'delete',
                where: { jid: '120363000000000000@g.us' },
                planFingerprint: deletePlan.planFingerprint
            })
        );
        check(
            'apply_mutation demands confirm for a destructive operation',
            destructiveApply.error === 'CONFIRMATION_REQUIRED',
            JSON.stringify(destructiveApply).slice(0, 200)
        );

        const features = parseToolResult(await client.callTool('cosmos_feature_list', { query: 'bank deposit' }));
        check(
            'feature_list resolves the spaced command name',
            features.features.some((feature) => (feature.invocations || []).includes('.bank deposit')),
            JSON.stringify(features).slice(0, 300)
        );

        const i18n = parseToolResult(await client.callTool('cosmos_i18n_check', { namespace: 'tools' }));
        check(
            'i18n_check reports the tools namespace',
            i18n.reports.length === 1 && i18n.reports[0].namespace === 'tools'
        );

        const schema = parseToolResult(await client.callTool('cosmos_schema_check'));
        check(
            'schema_check evaluates Rule W and Rule X',
            typeof schema.ruleW.pass === 'boolean' && typeof schema.ruleX.pass === 'boolean'
        );

        const status = parseToolResult(await client.callTool('cosmos_bot_status'));
        check(
            'bot_status returns BOT_OFFLINE, never a fabricated success',
            status.error === 'BOT_OFFLINE',
            JSON.stringify(status).slice(0, 200)
        );

        const broadcastDryRun = parseToolResult(
            await client.callTool('cosmos_bot_broadcast', {
                message: 'The bot will undergo scheduled maintenance shortly.',
                delayMs: 5000
            })
        );
        check(
            'bot_broadcast dry-run also reports BOT_OFFLINE offline',
            broadcastDryRun.error === 'BOT_OFFLINE',
            JSON.stringify(broadcastDryRun).slice(0, 200)
        );
    } finally {
        child.kill('SIGTERM');
    }

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
    if (failures > 0) {
        if (stderr) console.error(`\nServer stderr:\n${stderr.slice(-4000)}`);
        process.exitCode = 1;
    }
}

void main();
