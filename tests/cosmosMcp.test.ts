/**
 * Cosmos MCP Server — unit and integration tests.
 *
 * Covers the four properties the issue treats as non-negotiable:
 *  1. Fail-closed single-owner authentication with constant-time comparison and
 *     no credential leakage.
 *  2. A schema-aware, mandatory-limited, denylisted read-only SQL surface.
 *  3. A planner that refuses unknown columns and unsafe mutations, and gates the
 *     executor behind an identical-request fingerprint.
 *  4. Workspace-independent tool registration, including read-only compilation.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The production database is owned by the container user, so the suite runs
// against a dedicated scratch file under `storage/` instead.
const SCRATCH_DB = path.join(REPO_ROOT, 'storage', 'cosmos-mcp-test.sqlite');

process.env.COSMOS_MCP_TOKEN = 'unit-test-owner-key-0123456789';
process.env.INTERNAL_IPC_SECRET = process.env.INTERNAL_IPC_SECRET || 'unit-test-ipc-secret';
process.env.DATABASE_URL = `file:${SCRATCH_DB}`;

const { authenticateOwnerKey, extractTokenFromHeaders, fingerprintKey, OWNER_IDENTITY } =
    await import('../src/mcp/auth.js');
const { resetMcpConfigCache, loadMcpConfig, isLoopbackBind } = await import('../src/mcp/config.js');
const { McpToolError } = await import('../src/mcp/errors.js');
const {
    assertColumnsAllowed,
    assertTableAllowed,
    assertWhereClause,
    DENYLISTED_TABLES,
    parseSelect,
    WHERE_REQUIRED_TABLES
} = await import('../src/mcp/sql/guardrails.js');
const { parsePrismaSchema, findModel, resetSchemaCatalogueCache } = await import('../src/mcp/schema/prismaCatalog.js');
const { fingerprintMutation, planMutation } = await import('../src/mcp/schema/mutationPlanner.js');
const { runSchemaChecks } = await import('../src/mcp/schema/ddlMirror.js');
const { runToolingIsolationCheck } = await import('../src/mcp/schema/toolingIsolation.js');
const { runI18nCheck } = await import('../src/mcp/schema/i18nAudit.js');
const { issueContactRef, resolveContactRef, maskJid, maskPhone, maskDeep, clearContactRefs } =
    await import('../src/mcp/privacy.js');
const { mcpRateLimiter, resetAuditUserIdCache } = await import('../src/mcp/audit.js');

resetMcpConfigCache();
resetSchemaCatalogueCache();

describe('cosmos_mcp: configuration', () => {
    it('requires an owner key to consider the server configured', () => {
        assert.strictEqual(loadMcpConfig().token.length > 0, true);
    });

    it('refuses any non-loopback HTTP bind (Rule V)', () => {
        assert.strictEqual(isLoopbackBind('127.0.0.1'), true);
        assert.strictEqual(isLoopbackBind('::1'), true);
        assert.strictEqual(isLoopbackBind('0.0.0.0'), false);
        assert.strictEqual(isLoopbackBind('10.0.0.5'), false);
    });
});

describe('cosmos_mcp: single-owner authentication', () => {
    it('accepts the configured owner key and records the holder, not the key', () => {
        const identity = authenticateOwnerKey(process.env.COSMOS_MCP_TOKEN, 'stdio');
        assert.strictEqual(identity.identity, OWNER_IDENTITY);
        assert.notStrictEqual(identity.fingerprint, process.env.COSMOS_MCP_TOKEN);
        assert.ok(!identity.fingerprint.includes(process.env.COSMOS_MCP_TOKEN));
    });

    it('refuses a wrong key with UNAUTHORIZED_MCP', () => {
        assert.throws(
            () => authenticateOwnerKey('not-the-key', 'stdio'),
            (err: unknown) => err instanceof McpToolError && err.code === 'UNAUTHORIZED_MCP'
        );
    });

    it('refuses an absent or empty key rather than defaulting', () => {
        assert.throws(
            () => authenticateOwnerKey('', 'http'),
            (err: unknown) => err instanceof McpToolError && err.code === 'UNAUTHORIZED_MCP'
        );
        assert.throws(
            () => authenticateOwnerKey(undefined, 'http'),
            (err: unknown) => err instanceof McpToolError && err.code === 'UNAUTHORIZED_MCP'
        );
    });

    it('fails closed when no key is configured at all', () => {
        const previous = process.env.COSMOS_MCP_TOKEN;
        process.env.COSMOS_MCP_TOKEN = '   ';
        resetMcpConfigCache();
        try {
            assert.throws(
                () => authenticateOwnerKey('anything', 'stdio'),
                (err: unknown) => err instanceof McpToolError && err.code === 'UNAUTHORIZED_MCP'
            );
        } finally {
            process.env.COSMOS_MCP_TOKEN = previous;
            resetMcpConfigCache();
        }
    });

    it('reads the key from x-internal-secret or a bearer token', () => {
        assert.strictEqual(extractTokenFromHeaders({ 'x-internal-secret': 'abc' }), 'abc');
        assert.strictEqual(extractTokenFromHeaders({ authorization: 'Bearer xyz' }), 'xyz');
        assert.strictEqual(extractTokenFromHeaders({}), '');
    });

    it('produces a stable, non-reversible fingerprint', () => {
        assert.strictEqual(fingerprintKey('abc'), fingerprintKey('abc'));
        assert.notStrictEqual(fingerprintKey('abc'), fingerprintKey('abd'));
    });
});

describe('cosmos_mcp: SQL guardrails', () => {
    it('parses the FROM table and clause presence', () => {
        const parsed = parseSelect('SELECT id, balance FROM "User" WHERE id = ? LIMIT 10');
        assert.strictEqual(parsed.table, 'User');
        assert.strictEqual(parsed.hasWhere, true);
        assert.strictEqual(parsed.hasLimit, true);
    });

    it('refuses every write verb', () => {
        for (const sql of [
            'DELETE FROM "User"',
            'UPDATE "User" SET balance = 1',
            'DROP TABLE "User"',
            'INSERT INTO "User" (id) VALUES (1)',
            'PRAGMA table_info("User")',
            "ATTACH DATABASE 'x' AS y",
            'SELECT 1; DELETE FROM "User"'
        ]) {
            assert.throws(
                () => parseSelect(sql),
                (err: unknown) => err instanceof McpToolError && err.code === 'FORBIDDEN_SQL',
                `expected refusal: ${sql}`
            );
        }
    });

    it('accepts a legitimate read with an identifier that looks like a verb', () => {
        assert.doesNotThrow(() => parseSelect('SELECT id FROM "User" WHERE updatedAt > ? LIMIT 5'));
    });

    it('denylists every credential table with FORBIDDEN_TABLE', () => {
        for (const table of Object.keys(DENYLISTED_TABLES)) {
            assert.throws(
                () => assertTableAllowed(table),
                (err: unknown) => err instanceof McpToolError && err.code === 'FORBIDDEN_TABLE'
            );
        }
    });

    it('denylists credential columns and requires an explicit projection', () => {
        assert.throws(
            () => assertColumnsAllowed('User', ['passwordHash']),
            (err: unknown) => err instanceof McpToolError && err.code === 'FORBIDDEN_COLUMN'
        );
        assert.throws(
            () => assertColumnsAllowed('User', []),
            (err: unknown) => err instanceof McpToolError && err.code === 'FORBIDDEN_COLUMN'
        );
        assert.doesNotThrow(() => assertColumnsAllowed('User', ['id', 'balance']));
    });

    it('requires a WHERE clause for high-value tables', () => {
        for (const table of WHERE_REQUIRED_TABLES) {
            assert.throws(
                () => assertWhereClause(table, false),
                (err: unknown) => err instanceof McpToolError && err.code === 'MISSING_WHERE_CLAUSE'
            );
            assert.doesNotThrow(() => assertWhereClause(table, true));
        }
    });
});

describe('cosmos_mcp: Prisma schema catalogue', () => {
    const schemaSource = fs.readFileSync(path.join(REPO_ROOT, 'prisma', 'schema.prisma'), 'utf8');
    const catalogue = parsePrismaSchema(schemaSource, 'prisma/schema.prisma');

    it('parses the generator, datasource, models, and enums', () => {
        assert.strictEqual(catalogue.generator, 'prisma-client');
        assert.strictEqual(catalogue.datasource, 'sqlite');
        assert.ok(catalogue.modelCount >= 30, `expected at least 30 models, got ${catalogue.modelCount}`);
        assert.ok(catalogue.enums.some((entry) => entry.name === 'Language'));
        assert.ok(catalogue.enums.find((entry) => entry.name === 'Language')?.values.includes('ID'));
    });

    it('parses field metadata, defaults, indexes, and composite constraints', () => {
        const user = findModel(catalogue, 'User');
        assert.ok(user);
        const balance = user.fields.find((field) => field.name === 'balance');
        assert.strictEqual(balance?.type, 'BigInt');
        assert.strictEqual(balance?.default, '10000');

        const scheduled = findModel(catalogue, 'ScheduledDeletion');
        assert.deepStrictEqual(scheduled?.uniqueGroups, [['jid', 'msgId']]);

        const loan = findModel(catalogue, 'Loan');
        assert.ok(loan?.indexes.some((index) => index.fields.join(',') === 'userId'));
        assert.ok(loan?.indexes.some((index) => index.fields.join(',') === 'status'));
    });

    it('resolves relation targets in both directions', () => {
        const user = findModel(catalogue, 'User');
        assert.strictEqual(user?.fields.find((field) => field.name === 'loans')?.relationTo, 'Loan');
        const bankAccount = findModel(catalogue, 'BankAccount');
        assert.strictEqual(
            bankAccount?.fields.find((field) => field.name === 'transactions')?.relationTo,
            'BankTransaction'
        );
    });

    it('resolves the live catalogue from disk', async () => {
        const { loadSchemaCatalogue } = await import('../src/mcp/schema/prismaCatalog.js');
        const live = loadSchemaCatalogue();
        assert.ok(live);
        assert.ok(live.modelCount >= 30);
    });
});

describe('cosmos_mcp: mutation planner', () => {
    it('plans a safe User update and emits the required boilerplate', () => {
        const request = {
            model: 'User',
            operation: 'update' as const,
            set: { balance: 5000 },
            where: { id: '628@s.whatsapp.net' }
        };
        const plan = planMutation(request);
        assert.strictEqual(plan.safe, true);
        assert.strictEqual(plan.model, 'User');
        assert.strictEqual(plan.requiresTransaction, true);
        assert.strictEqual(plan.requiresActivityLog, true);
        assert.strictEqual(plan.destructive, false);
        assert.ok(plan.transactionSnippet.includes('prisma.$transaction'));
        assert.ok(plan.prismaSnippet.includes('updateMany'));
        assert.ok(plan.checklist.some((item) => item.rule.startsWith('W (dual maintenance)')));
    });

    it('refuses an invented column, naming it explicitly', () => {
        const plan = planMutation({ model: 'User', operation: 'update', set: { balnace: 1 }, where: { id: 'x' } });
        assert.strictEqual(plan.safe, false);
        assert.ok(plan.blockers.some((blocker) => blocker.includes('does not exist in prisma/schema.prisma')));
    });

    it('refuses an unbounded update or delete', () => {
        const update = planMutation({ model: 'User', operation: 'update', set: { balance: 1 } });
        assert.strictEqual(update.safe, false);
        const remove = planMutation({ model: 'User', operation: 'delete' });
        assert.strictEqual(remove.safe, false);
    });

    it('marks a destructive operation and demands confirmation downstream', () => {
        const plan = planMutation({ model: 'GroupNsfwSetting', operation: 'delete', where: { jid: '1@g.us' } });
        assert.strictEqual(plan.safe, true);
        assert.strictEqual(plan.destructive, true);
    });

    it('never plans a write to a credential table', () => {
        const plan = planMutation({
            model: 'WhatsAppAuth',
            operation: 'update',
            set: { value: 'x' },
            where: { id: 'default' }
        });
        assert.strictEqual(plan.safe, false);
        assert.ok(plan.blockers.some((blocker) => blocker.includes('not writable')));
    });

    it('refuses to drop a model', () => {
        const plan = planMutation({ model: 'User', operation: 'drop' });
        assert.strictEqual(plan.safe, false);
    });

    it('rejects an unknown model with the available list', () => {
        assert.throws(
            () => planMutation({ model: 'NotAModel', operation: 'update', set: { a: 1 }, where: { id: '1' } }),
            (err: unknown) => err instanceof McpToolError && err.code === 'UNKNOWN_MODEL'
        );
    });

    it('requires the Rule W 3-phase DDL when a column does not exist yet', () => {
        const plan = planMutation({
            model: 'User',
            operation: 'update',
            set: { brandNewColumn: 1 },
            where: { id: '1' }
        });
        assert.strictEqual(plan.safe, false);
        assert.strictEqual(plan.requiresSchemaChange, true);
        assert.strictEqual(plan.requiresDdlMigration, true);
        assert.deepStrictEqual(plan.mirrorTargets, ['prisma/schema.prisma', 'src/db.ts', '.worktrees/api/src/db.ts']);
    });

    it('demands balanceAfter for the bank transaction ledger', () => {
        const plan = planMutation({
            model: 'BankTransaction',
            operation: 'create',
            set: { accountNumber: '1', type: 'DEPOSIT', amount: 100 }
        });
        assert.strictEqual(plan.requiresBalanceAfter, true);
        assert.strictEqual(plan.requiresAcidTransaction, true);
    });

    it('fingerprints a request independently of key order', () => {
        const a = fingerprintMutation({
            model: 'User',
            operation: 'update',
            set: { balance: 1, isWhitelisted: true },
            where: { id: 'x' }
        });
        const b = fingerprintMutation({
            model: 'User',
            operation: 'update',
            set: { isWhitelisted: true, balance: 1 },
            where: { id: 'x' }
        });
        assert.strictEqual(a, b);
        const c = fingerprintMutation({
            model: 'User',
            operation: 'update',
            set: { balance: 2, isWhitelisted: true },
            where: { id: 'x' }
        });
        assert.notStrictEqual(a, c);
    });
});

describe('cosmos_mcp: privacy', () => {
    before(() => clearContactRefs());
    after(() => clearContactRefs());

    it('masks a JID and a phone number', () => {
        assert.ok(!maskJid('6281234567890@s.whatsapp.net').includes('1234567'));
        assert.ok(maskJid('6281234567890@s.whatsapp.net').endsWith('@s.whatsapp.net'));
        assert.ok(!maskPhone('6281234567890').includes('2345'));
    });

    it('masks contact-like values recursively', () => {
        const masked = maskDeep({
            user: { id: '6281234567890@s.whatsapp.net' },
            phone: '6281234567890',
            note: 'ok'
        }) as Record<string, Record<string, string>>;
        assert.ok(!masked.user.id.includes('1234567'));
        assert.ok(!masked.phone.includes('1234567'));
        assert.strictEqual(masked.note, 'ok');
    });

    it('issues and resolves an ephemeral contact_ref alias', () => {
        const ref = issueContactRef('120363123456789012@g.us', OWNER_IDENTITY);
        assert.ok(ref.startsWith('contact_ref_'));
        assert.strictEqual(resolveContactRef(ref, OWNER_IDENTITY), '120363123456789012@g.us');
    });

    it('refuses an alias presented by a different identity', () => {
        const ref = issueContactRef('120363123456789012@g.us', OWNER_IDENTITY);
        assert.strictEqual(resolveContactRef(ref, 'someone-else'), null);
    });

    it('refuses an unknown alias', () => {
        assert.strictEqual(resolveContactRef('contact_ref_deadbeef', OWNER_IDENTITY), null);
    });
});

describe('cosmos_mcp: rate limiter', () => {
    it('refuses a mutation beyond the configured ceiling', () => {
        mcpRateLimiter.reset();
        const identity = authenticateOwnerKey(process.env.COSMOS_MCP_TOKEN, 'stdio');
        const ceiling = loadMcpConfig().rateLimit.maxMutations;
        // Each accepted call acquires a concurrency slot, so release it as a real
        // caller would, isolating the sliding-window ceiling under test.
        for (let i = 0; i < ceiling; i += 1) {
            mcpRateLimiter.assertAllowed(identity, true);
            mcpRateLimiter.releaseMutationSlot();
        }
        assert.throws(
            () => mcpRateLimiter.assertAllowed(identity, true),
            (err: unknown) => err instanceof McpToolError && err.code === 'RATE_LIMITED'
        );
        mcpRateLimiter.reset();
    });

    it('enforces the concurrency ceiling and releases slots', () => {
        mcpRateLimiter.reset();
        const identity = authenticateOwnerKey(process.env.COSMOS_MCP_TOKEN, 'stdio');
        const ceiling = loadMcpConfig().rateLimit.maxConcurrentMutations;
        for (let i = 0; i < ceiling; i += 1) mcpRateLimiter.assertAllowed(identity, true);
        assert.throws(
            () => mcpRateLimiter.assertAllowed(identity, true),
            (err: unknown) => err instanceof McpToolError && err.code === 'RATE_LIMITED'
        );
        for (let i = 0; i < ceiling; i += 1) mcpRateLimiter.releaseMutationSlot();
        assert.doesNotThrow(() => mcpRateLimiter.assertAllowed(identity, true));
        mcpRateLimiter.releaseMutationSlot();
        mcpRateLimiter.reset();
    });
});

describe('cosmos_mcp: repository governance checks', () => {
    it('reports the Rule W DDL mirror state without throwing', () => {
        const report = runSchemaChecks();
        assert.strictEqual(typeof report.migrationOrderValid, 'boolean');
        assert.ok(Array.isArray(report.drivers));
        assert.strictEqual(report.drivers.length, 2);
        assert.ok(
            report.drivers.some(
                (driver) => driver.relativePath === 'src/db.ts' && driver.available && driver.hasBootstrap
            )
        );
        assert.ok(report.drivers.some((driver) => driver.relativePath === '.worktrees/api/src/db.ts'));
    });

    it('flags the API DDL driver when the sibling worktree is absent', () => {
        const report = runSchemaChecks();
        const api = report.drivers.find((driver) => driver.relativePath === '.worktrees/api/src/db.ts');
        if (!api?.available) {
            assert.ok(report.findings.some((finding) => finding.includes('.worktrees/api/src/db.ts')));
        }
    });

    it('passes the Rule X worktree isolation check in this repository', () => {
        const isolation = runToolingIsolationCheck();
        assert.strictEqual(isolation.pass, true, isolation.findings.join(' | '));
    });

    it('audits translation parity across every namespace', () => {
        const report = runI18nCheck();
        assert.ok(report.namespaces.includes('tools'));
        assert.strictEqual(report.reports.length, report.namespaces.length);
        for (const namespaceReport of report.reports) {
            assert.strictEqual(namespaceReport.filesPresent, true, `${namespaceReport.namespace} files missing`);
        }
    });
});

describe('cosmos_mcp: persisted broadcast fan-out (Rule J)', () => {
    it('previews a broadcast against the WhitelistedGroup fallback without sending', async () => {
        const { prisma } = await import('../src/db.js');
        const { previewBroadcast } = await import('../src/services/broadcastService.js');

        await prisma.whitelistedGroup.deleteMany({ where: { jid: { startsWith: '120363999' } } });
        await prisma.whitelistedGroup.createMany({
            data: [
                { jid: '120363999000000001@g.us', language: 'EN' },
                { jid: '120363999000000002@g.us', language: 'ID' }
            ]
        });

        const preview = await previewBroadcast({ message: 'Scheduled maintenance.', delayMs: 5000 });
        assert.strictEqual(preview.source, 'whitelist');
        assert.ok(preview.targetCount >= 2);
        assert.ok(preview.maskedTargets.every((entry) => !entry.includes('000000001')));
        assert.ok(preview.estimatedDurationMs >= 5000);
        assert.strictEqual(preview.messageLength, 'Scheduled maintenance.'.length);

        await prisma.whitelistedGroup.deleteMany({ where: { jid: { startsWith: '120363999' } } });
    });

    it('persists one scheduled delivery row per target and can be cancelled', async () => {
        const { prisma } = await import('../src/db.js');
        const { startBroadcast, getBroadcastStatus, cancelBroadcast, BROADCAST_EVENT, BROADCAST_CHANNEL_PREFIX } =
            await import('../src/services/broadcastService.js');

        await prisma.whitelistedGroup.deleteMany({ where: { jid: { startsWith: '120363888' } } });
        await prisma.whitelistedGroup.createMany({
            data: [
                { jid: '120363888000000001@g.us', language: 'EN' },
                { jid: '120363888000000002@g.us', language: 'EN' },
                { jid: '120363888000000003@g.us', language: 'EN' }
            ]
        });

        const started = await startBroadcast({
            message: 'Maintenance notice.',
            delayMs: 1000,
            requestedBy: 'repository-owner'
        });
        assert.ok(started.jobId.startsWith('bcast_'));
        assert.strictEqual(started.queued, started.receipts.length);

        const rows = await prisma.statusNotificationOutbox.findMany({
            where: { event: BROADCAST_EVENT, payload: { contains: `"jobId":"${started.jobId}"` } },
            orderBy: { nextAttemptAt: 'asc' }
        });
        assert.strictEqual(rows.length, 3);
        assert.ok(rows.every((row) => row.channel.startsWith(BROADCAST_CHANNEL_PREFIX)));
        // The schedule is staggered, not an in-memory sleep.
        assert.ok(rows[1].nextAttemptAt.getTime() > rows[0].nextAttemptAt.getTime());
        assert.ok(rows[2].nextAttemptAt.getTime() > rows[1].nextAttemptAt.getTime());

        const status = await getBroadcastStatus(started.jobId);
        assert.ok(status);
        assert.strictEqual(status.counts.pending, 3);
        assert.ok(status.receipts.every((receipt) => receipt.status === 'PENDING'));
        assert.ok(status.receipts.every((receipt) => !receipt.target.includes('000000001')));

        const cancelled = await cancelBroadcast(started.jobId);
        assert.strictEqual(cancelled, true);

        const after = await getBroadcastStatus(started.jobId);
        assert.strictEqual(after?.counts.cancelled, 3);
        assert.strictEqual(after?.status, 'CANCELLED');

        await prisma.statusNotificationOutbox.deleteMany({
            where: { event: BROADCAST_EVENT, payload: { contains: `"jobId":"${started.jobId}"` } }
        });
        await prisma.statusNotificationLog.deleteMany({
            where: { event: BROADCAST_EVENT, channels: { contains: started.jobId } }
        });
        await prisma.whitelistedGroup.deleteMany({ where: { jid: { startsWith: '120363888' } } });
    });

    it('keeps the status-notifier outbox worker away from broadcast rows', async () => {
        const { prisma } = await import('../src/db.js');
        const { BROADCAST_EVENT, BROADCAST_CHANNEL_PREFIX } = await import('../src/services/broadcastService.js');

        const channel = `${BROADCAST_CHANNEL_PREFIX}120363777000000001@g.us`;
        // The scratch database survives between runs, so purge leftovers first to
        // keep the assertion scoped to the row created below.
        await prisma.statusNotificationOutbox.deleteMany({ where: { channel } });

        const created = await prisma.statusNotificationOutbox.create({
            data: {
                event: BROADCAST_EVENT,
                severity: 'INFO',
                channel,
                payload: JSON.stringify({
                    jobId: 'bcast_worker_isolation',
                    jid: '120363777000000001@g.us',
                    message: 'x'
                }),
                status: 'PENDING',
                attempts: 0,
                maxAttempts: 3,
                nextAttemptAt: new Date(0)
            }
        });

        // The notifier worker validates `channel` against its own channel list and
        // would terminally fail this row; the explicit skip must prevent that.
        const { processOutboxBatch } = await import('../src/services/statusNotifier/outboxWorker.js');
        await processOutboxBatch();

        const survivor = await prisma.statusNotificationOutbox.findUnique({ where: { id: created.id } });
        assert.ok(survivor, 'the broadcast delivery row must survive the notifier worker batch');
        assert.strictEqual(survivor.status, 'PENDING');
        assert.strictEqual(survivor.attempts, 0);

        await prisma.statusNotificationOutbox.deleteMany({ where: { channel } });
    });
});

describe('cosmos_mcp: read-only SQL execution', () => {
    it('reads through a genuinely read-only handle and masks contacts', async () => {
        const { prisma } = await import('../src/db.js');
        await prisma.whitelistedGroup.deleteMany({ where: { jid: '120363555000000123@g.us' } });
        await prisma.whitelistedGroup.create({ data: { jid: '120363555000000123@g.us', language: 'EN' } });

        const { runGuardedSelect, describeDatabase } = await import('../src/mcp/sql/readOnlyDb.js');
        const info = describeDatabase();
        assert.strictEqual(info.readOnly, true);
        assert.strictEqual(info.readable, true);

        const result = runGuardedSelect({
            sql: 'SELECT jid, language FROM "WhitelistedGroup" WHERE jid = ? LIMIT 5',
            params: ['120363555000000123@g.us']
        });
        assert.strictEqual(result.rowCount, 1);
        assert.ok(!String(result.rows[0].jid).includes('000000123'));
        assert.strictEqual(result.rows[0].language, 'EN');

        // The connection is opened read-only: a write attempt fails at SQLite level.
        assert.throws(() =>
            runGuardedSelect({ sql: 'INSERT INTO "WhitelistedGroup" (jid) VALUES (?) LIMIT 1', params: ['x@g.us'] })
        );

        await prisma.whitelistedGroup.deleteMany({ where: { jid: '120363555000000123@g.us' } });
    });

    it('counts and aggregates through the helpers', async () => {
        const { prisma } = await import('../src/db.js');
        const { runCount, runAggregate } = await import('../src/mcp/sql/readOnlyDb.js');

        const before = await prisma.jobCatalog.count();
        assert.strictEqual(runCount({ table: 'JobCatalog' }).count, before);

        const aggregate = runAggregate({ table: 'JobCatalog', column: 'baseSalary', aggregate: 'sum' });
        assert.strictEqual(aggregate.rowCount, 1);
        assert.ok(aggregate.sql.includes('SUM'));
    });
});

describe('cosmos_mcp: transport selection', () => {
    it('accepts both the space-separated and equals forms of --transport', async () => {
        const { parseTransport } = await import('../src/mcp/index.js');

        // The equals form is what PM2 passes from `args: '--transport=http'` in
        // docker/ecosystem.config.cjs. It arrives as ONE argv string, so the
        // original `indexOf('--transport')` lookup missed it and the server fell
        // back to stdio while still reporting `online`, serving nothing on 4100.
        assert.strictEqual(parseTransport(['--transport=http']), 'http');
        assert.strictEqual(parseTransport(['--transport', 'http']), 'http');
        assert.strictEqual(parseTransport(['--transport=stdio']), 'stdio');
        assert.strictEqual(parseTransport(['--transport', 'stdio']), 'stdio');
        assert.strictEqual(parseTransport(['--http']), 'http');
        assert.strictEqual(parseTransport([]), 'stdio');
        assert.strictEqual(parseTransport(['--transport=http', '--verbose']), 'http');

        // Unsupported values must still fail loudly rather than silently
        // downgrading to stdio, which is what hid the original defect.
        assert.throws(() => parseTransport(['--transport=carrier-pigeon']), /Unsupported transport/);
        assert.throws(() => parseTransport(['--transport']), /Missing value/);
        assert.throws(() => parseTransport(['--transport', 'grpc']), /Unsupported transport/);
    });
});

describe('cosmos_mcp: server assembly', () => {
    it('registers the documented tool surface', async () => {
        resetAuditUserIdCache();
        const { buildMcpServer } = await import('../src/mcp/server.js');
        const identity = authenticateOwnerKey(process.env.COSMOS_MCP_TOKEN, 'stdio');
        const { summary } = buildMcpServer(identity);

        for (const expected of [
            'cosmos_db_describe',
            'cosmos_db_query',
            'cosmos_db_count',
            'cosmos_db_aggregate',
            'cosmos_db_mutation_plan',
            'cosmos_db_apply_mutation',
            'cosmos_db_backup',
            'cosmos_db_restore_plan',
            'cosmos_db_migration_status',
            'cosmos_db_settings_summary',
            'cosmos_feature_list',
            'cosmos_feature_describe',
            'cosmos_feature_invoke',
            'cosmos_settings_get',
            'cosmos_settings_set',
            'cosmos_i18n_check',
            'cosmos_schema_check',
            'cosmos_guidance',
            'cosmos_bot_status',
            'cosmos_bot_health',
            'cosmos_bot_groups_list',
            'cosmos_bot_send_message',
            'cosmos_bot_broadcast',
            'cosmos_bot_broadcast_status',
            'cosmos_bot_broadcast_cancel',
            'cosmos_bot_reconnect',
            'cosmos_bot_logout',
            'cosmos_bot_subbot_list',
            'cosmos_bot_subbot_status'
        ]) {
            assert.ok(summary.registered.includes(expected), `missing tool: ${expected}`);
        }
        assert.strictEqual(summary.skippedByReadOnly.length, 0);
    });

    it('compiles the mutating toolset out in read-only mode', async () => {
        const previous = process.env.COSMOS_MCP_READ_ONLY;
        process.env.COSMOS_MCP_READ_ONLY = 'true';
        resetMcpConfigCache();
        try {
            const { buildMcpServer } = await import('../src/mcp/server.js');
            const identity = authenticateOwnerKey(process.env.COSMOS_MCP_TOKEN, 'stdio');
            const { summary } = buildMcpServer(identity);
            for (const hidden of ['cosmos_db_apply_mutation', 'cosmos_bot_broadcast', 'cosmos_settings_set']) {
                assert.ok(!summary.registered.includes(hidden), `${hidden} must not exist in read-only mode`);
                assert.ok(summary.skippedByReadOnly.includes(hidden));
            }
            assert.ok(summary.registered.includes('cosmos_db_describe'));
        } finally {
            process.env.COSMOS_MCP_READ_ONLY = previous;
            resetMcpConfigCache();
        }
    });
});
