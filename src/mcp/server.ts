/**
 * Cosmos MCP Server — server assembly.
 *
 * One `McpServer` instance is built per authenticated identity. That is what
 * lets the stdio transport (one long-lived owner session) and the Streamable HTTP
 * transport (many short-lived sessions) share the exact same tool code while
 * keeping the acting identity explicit and auditable.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { authenticateOwnerKey, type McpIdentity } from './auth.js';
import { loadMcpConfig } from './config.js';
import { getVersionInfo } from '#lib/versioning.js';
import { registerDbTools } from './tools/dbTools.js';
import { registerFeatureTools } from './tools/featureTools.js';
import { registerBotTools } from './tools/botTools.js';
import { registerTool, type McpToolDeps, type RegistrationSummary } from './registry.js';
import { zod } from './registry.js';

export interface BuiltMcpServer {
    server: McpServer;
    summary: RegistrationSummary;
}

const SERVER_NAME = 'cosmos-mcp';

/**
 * Instructions handed to every connecting agent. This is the machine-readable
 * half of the contract documented in AGENTS.md §AI and
 * `.agents/skills/cosmos-mcp/SKILL.md`.
 */
const SERVER_INSTRUCTIONS = [
    'Cosmos operations MUST be performed through the Cosmos MCP tools.',
    'Do NOT use npm or yarn: this project is PNPM-only.',
    'Do NOT install ad-hoc CLI packages and do NOT write throwaway scripts for a Cosmos task.',
    'Do NOT open the SQLite file directly or write raw SQL.',
    'Call cosmos_guidance first for tool-selection guidance, then cosmos_db_describe before any mutation.',
    'Run cosmos_db_mutation_plan before cosmos_db_apply_mutation; the apply call refuses without the plan fingerprint.',
    'Live bot actions return BOT_OFFLINE when the engine is unreachable; never assume success.'
].join(' ');

/**
 * Builds the Cosmos MCP server for one authenticated identity.
 *
 * @param identity The verified owner identity. Callers MUST obtain it through
 * {@link authenticateOwnerKey}; there is no path that constructs a server for an
 * unauthenticated caller.
 */
export function buildMcpServer(identity: McpIdentity): BuiltMcpServer {
    const config = loadMcpConfig();
    const version = getVersionInfo().version;

    const server = new McpServer(
        { name: SERVER_NAME, version },
        {
            capabilities: { tools: {}, resources: {}, prompts: {} },
            instructions: SERVER_INSTRUCTIONS
        }
    );

    const deps: McpToolDeps = { identity };
    const summary: RegistrationSummary = { registered: [], skippedByReadOnly: [] };

    registerDbTools(server, deps, summary);
    registerFeatureTools(server, deps, summary);
    registerBotTools(server, deps, summary);
    registerGuidanceTools(server, deps, summary);

    registerResource(server, {
        name: 'cosmos-schema',
        uri: 'cosmos://schema/catalogue',
        description: 'The live Cosmos Prisma model catalogue, so an agent never has to read schema.prisma by hand.',
        mimeType: 'application/json',
        read: async () => ({ summary: summary.registered.length, tools: summary.registered })
    });

    console.log(
        `[MCP] Server ready for ${identity.identity} via ${identity.transport}: ${summary.registered.length} tool(s) registered` +
            (summary.skippedByReadOnly.length > 0
                ? `, ${summary.skippedByReadOnly.length} compiled out by read-only mode`
                : '') +
            (config.readOnly ? ' (READ-ONLY MODE)' : '') +
            '.'
    );

    return { server, summary };
}

interface ResourceConfig {
    name: string;
    uri: string;
    description: string;
    mimeType: string;
    read: () => Promise<Record<string, unknown>>;
}

function registerResource(server: McpServer, config: ResourceConfig): void {
    server.registerResource(
        config.name,
        config.uri,
        { description: config.description, mimeType: config.mimeType },
        async () => ({
            contents: [
                {
                    uri: config.uri,
                    mimeType: config.mimeType,
                    text: JSON.stringify(await config.read(), null, 2)
                }
            ]
        })
    );
}

/**
 * Registers `cosmos_guidance`, the machine-readable half of the agent contract
 * from AGENTS.md §AI: what Cosmos is, which tool to use for which intent, and
 * the hard prohibitions (no npm, no ad-hoc scripts, no direct SQLite access).
 */
function registerGuidanceTools(server: McpServer, deps: McpToolDeps, summary: RegistrationSummary): void {
    registerTool(
        server,
        'cosmos_guidance',
        {
            description:
                'Return the canonical Cosmos operating contract for AI coding agents: the tool-selection map from intent to tool, the hard prohibitions (never use npm, never install ad-hoc CLI packages, never write throwaway scripts, never open the SQLite file directly), and the governance rules that apply to every change. Read this first in an unfamiliar workspace.',
            inputSchema: {
                intent: zod.optionalString(
                    'Return only the tool-selection guidance for this intent, for example "broadcast an announcement to all groups".'
                )
            },
            handler: async (args) => {
                const intent = args.intent as string | undefined;
                const selection = TOOL_SELECTION.map((entry) => ({
                    intent: entry.intent,
                    tools: entry.tools,
                    note: entry.note
                }));
                if (intent) {
                    const needle = intent.toLowerCase();
                    const matches = selection.filter(
                        (entry) =>
                            needle.includes(entry.intent.split(' ')[0]) ||
                            entry.intent.toLowerCase().includes(needle.split(' ')[0])
                    );
                    return { intent, guidance: matches.length > 0 ? matches : selection, prohibitions: PROHIBITIONS };
                }
                return {
                    contract: CONTRACT,
                    prohibitions: PROHIBITIONS,
                    toolSelection: selection,
                    governance: GOVERNANCE
                };
            }
        },
        deps,
        summary
    );
}

const CONTRACT = [
    'Cosmos operations MUST be performed through the Cosmos MCP tools.',
    'All Cosmos-touching work goes through the cosmos_db_*, cosmos_*, or cosmos_bot_* namespaces.',
    'The MCP server runs from the deployed Cosmos deployment, so an agent in a fresh clone, in a sibling worktree, or on another machine has identical capabilities.',
    'Read cosmos_guidance, then cosmos_db_describe, before mutating anything.'
];

const PROHIBITIONS = [
    'Do NOT use npm or yarn: the project is PNPM-only (pnpm-lock.yaml).',
    'Do NOT install ad-hoc CLI packages to accomplish a Cosmos task.',
    'Do NOT write throwaway scripts to accomplish a Cosmos task; every such request has a first-class tool.',
    'Do NOT open the SQLite file directly or write raw SQL; use cosmos_db_describe, cosmos_db_query, and cosmos_db_mutation_plan.',
    'Do NOT bypass the ACID rules; financial mutations require a plan pass and run inside prisma.$transaction.',
    'Do NOT edit prisma/schema.prisma without mirroring the change into both src/db.ts and .worktrees/api/src/db.ts (Rule W).'
];

const GOVERNANCE = [
    'Rule H: every output string is Formal English.',
    'Rule J: persisted queues, never in-memory setTimeout, for anything that must survive a restart.',
    'Rule N: interactive flows register with cancellationManager and honour .cancel.',
    'Rule AF: command names are spaced, for example `.bank deposit`.',
    'Rule C: operational logs are printed to console.log so they appear in the Pterodactyl panel.',
    'Rule W: schema changes follow the 3-phase DDL order: CREATE TABLE, then ensureColumnExists, then CREATE INDEX.',
    'Rule Y: never fabricate data. A tool that needs the live engine returns BOT_OFFLINE when the engine is unreachable.'
];

const TOOL_SELECTION: Array<{ intent: string; tools: string[]; note: string }> = [
    {
        intent: 'broadcast an announcement to all groups',
        tools: ['cosmos_bot_broadcast'],
        note: 'One call. Dry-run by default; the fan-out is persisted and cancellable. Never write a bespoke broadcast script.'
    },
    {
        intent: 'update a database row',
        tools: ['cosmos_db_describe', 'cosmos_db_mutation_plan', 'cosmos_db_apply_mutation'],
        note: 'Describe first, plan second, apply third. The apply call refuses without the plan fingerprint.'
    },
    {
        intent: 'read or report on the database',
        tools: [
            'cosmos_db_describe',
            'cosmos_db_query',
            'cosmos_db_count',
            'cosmos_db_aggregate',
            'cosmos_db_settings_summary'
        ],
        note: 'Read-only, mandatory LIMIT, mandatory WHERE on high-value tables.'
    },
    {
        intent: 'discover the bot commands',
        tools: ['cosmos_feature_list', 'cosmos_feature_describe'],
        note: 'Returns the canonical spaced invocation, for example `.bank deposit`, plus en/id descriptions.'
    },
    {
        intent: 'run or validate a bot command',
        tools: ['cosmos_feature_invoke'],
        note: 'Dry-run by default: it validates the command without side effects.'
    },
    {
        intent: 'change runtime configuration',
        tools: ['cosmos_settings_get', 'cosmos_settings_set'],
        note: 'Configuration lives in the database, not in .env on disk.'
    },
    {
        intent: 'check translation parity',
        tools: ['cosmos_i18n_check'],
        note: 'Satisfies Rule O as a tool call.'
    },
    {
        intent: 'check schema and repository governance',
        tools: ['cosmos_schema_check', 'cosmos_db_migration_status'],
        note: 'Rule W dual maintenance, 3-phase DDL ordering, and Rule X worktree isolation.'
    },
    {
        intent: 'message a user or a group',
        tools: ['cosmos_bot_groups_list', 'cosmos_bot_send_message'],
        note: 'Resolve the target through the group list; use the returned contact_ref alias.'
    },
    {
        intent: 'inspect or restore engine health',
        tools: ['cosmos_bot_status', 'cosmos_bot_health', 'cosmos_bot_reconnect', 'cosmos_bot_logout'],
        note: 'Never fabricate engine state; BOT_OFFLINE is returned when the engine is down.'
    },
    {
        intent: 'back up or restore the database',
        tools: ['cosmos_db_backup', 'cosmos_db_restore_plan'],
        note: 'Backups run the existing pipeline; restores are plan-only and require an explicit operator action.'
    }
];

/** Authenticates a caller and builds a server for it. Used by both transports. */
export function buildAuthenticatedServer(
    presentedToken: string | undefined,
    transport: McpIdentity['transport']
): BuiltMcpServer {
    const identity = authenticateOwnerKey(presentedToken, transport);
    return buildMcpServer(identity);
}
