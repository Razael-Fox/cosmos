/**
 * Cosmos MCP Server — `cosmos_*` feature and configuration tool group.
 *
 * Turns the prose rules of AGENTS.md Rule AF (spaced command names) and Rule T
 * (symmetric `en`/`id` i18n registration) into machine-checkable invariants, so
 * a coding agent knows that the command is `.bank deposit` and not `.bank`
 * without reading the source.
 */
import toolsHandler from '#tools/handler.js';
import { resolveToolDescription, type ToolDefinition } from '#tools/types.js';
import { getTranslator } from '#utils/i18n.js';
import { runI18nCheck } from '../schema/i18nAudit.js';
import { runSchemaChecks } from '../schema/ddlMirror.js';
import { runToolingIsolationCheck } from '../schema/toolingIsolation.js';
import { loadSchemaCatalogue } from '../schema/prismaCatalog.js';
import { McpToolError } from '../errors.js';
import { recordAudit } from '../audit.js';
import { registerTool, zod, type ToolRegistrar } from '../registry.js';

interface FeatureSummary {
    name: string;
    invocation: string;
    /** Spaced sub-commands discovered from the tool's `action` parameter. */
    subcommands: string[];
    /** Canonical spaced invocations, e.g. `.bank deposit`. */
    invocations: string[];
    description: string;
    descriptionKey?: string;
    category?: string;
    aliases: string[];
    displayNames: Partial<Record<'en' | 'id', string>>;
    parameters?: Record<string, unknown>;
    ownerOnly: boolean;
}

async function collectFeatures(): Promise<ToolDefinition[]> {
    await toolsHandler.loadTools();
    return toolsHandler.getAllTools().map((module) => module.definition);
}

/** Rule AF: the canonical invocation form is the dotted, spaced command name. */
function invocationOf(definition: ToolDefinition): string {
    return `.${definition.name.replace(/^[.\s]+/, '')}`;
}

/**
 * Extracts the sub-command verbs a tool declares through its `action`
 * parameter, for example `.bank deposit` or `.group promote`.
 */
export function declaredActions(definition: ToolDefinition): string[] {
    const properties = (definition.parameters ?? {}).properties ?? {};
    const action = properties.action as { description?: string; enum?: string[] } | undefined;
    if (!action) return [];
    if (Array.isArray(action.enum) && action.enum.length > 0) return action.enum;

    const description = action.description ?? '';
    const colonIndex = description.indexOf(':');
    if (colonIndex === -1) return [];
    return description
        .slice(colonIndex + 1)
        .split(',')
        .map((entry) => entry.trim().split(/\s+/)[0])
        .map((entry) => entry.replace(/[^\w-]/g, ''))
        .filter((entry) => entry.length > 0);
}

/**
 * Rule AF: every user-facing invocation must be a spaced command name. A tool
 * whose own name is a single word is a DOMAIN NAMESPACE and is compliant when it
 * declares at least one `action` sub-command (`.bank deposit`); a single-word
 * tool with no sub-commands is a genuine violation.
 */
function checkSpacedCommandName(definition: ToolDefinition): string[] {
    const violations: string[] = [];
    const clean = definition.name.replace(/^[.\s]+/, '');
    if (!clean) return violations;

    const actions = declaredActions(definition);
    if (!clean.includes(' ') && actions.length === 0) {
        violations.push(
            `${invocationOf(definition)} is a single-word command with no declared sub-command. Rule AF requires a spaced command name such as \`.bank deposit\` or \`.daily claim\`.`
        );
    }

    if (definition.aliases) {
        for (const alias of definition.aliases) {
            const cleanAlias = alias.replace(/^[.\s]+/, '');
            if (cleanAlias && !cleanAlias.includes(' ') && actions.length === 0 && cleanAlias !== clean) {
                violations.push(
                    `Alias \`${alias}\` of ${invocationOf(definition)} is not a spaced multi-word command (Rule AF).`
                );
            }
        }
    }
    return violations;
}

function toSummary(definition: ToolDefinition): FeatureSummary {
    const actions = declaredActions(definition);
    return {
        name: definition.name,
        invocation: invocationOf(definition),
        subcommands: actions,
        invocations:
            actions.length > 0
                ? actions.map((action) => `${invocationOf(definition)} ${action}`)
                : [invocationOf(definition)],
        description: resolveToolDescription(definition),
        descriptionKey: definition.descriptionKey,
        category: definition.category,
        aliases: definition.aliases ?? [],
        displayNames: definition.displayNames ?? {},
        parameters: definition.parameters,
        ownerOnly: definition.owner === true
    };
}

export const registerFeatureTools: ToolRegistrar = (server, deps, summary) => {
    registerTool(
        server,
        'cosmos_feature_list',
        {
            description:
                'Enumerate the Cosmos bot command registry: every registered feature with its canonical spaced invocation (Rule AF), Formal English description, descriptionKey, aliases, and English/Indonesian display names. Use this instead of reading src/tools/ by hand.',
            inputSchema: {
                category: zod.optionalString('Return only features in this category.'),
                query: zod.optionalString('Return only features whose name, alias, or description contains this text.'),
                includeParameters: zod.optionalBoolean('Include each feature parameter schema. Defaults to false.')
            },
            handler: async (args) => {
                const definitions = await collectFeatures();
                const category = args.category as string | undefined;
                const query = (args.query as string | undefined)?.trim().toLowerCase();
                const includeParameters = args.includeParameters !== false;

                let features = definitions;
                if (category) features = features.filter((definition) => definition.category === category);
                if (query) {
                    features = features.filter((definition) => {
                        const haystack = [
                            definition.name,
                            ...(definition.aliases ?? []),
                            definition.description,
                            ...declaredActions(definition),
                            ...Object.values(definition.displayNames ?? {})
                        ]
                            .join(' ')
                            .toLowerCase();
                        // Match every whitespace-separated term so a query such as
                        // `bank deposit` resolves the `.bank deposit` invocation.
                        return query
                            .split(/\s+/)
                            .filter(Boolean)
                            .every((term) => haystack.includes(term));
                    });
                }

                const sorted = [...features].sort((a, b) => a.name.localeCompare(b.name));
                return {
                    count: sorted.length,
                    features: sorted.map((definition) => {
                        const entry = toSummary(definition);
                        if (!includeParameters) delete entry.parameters;
                        return entry;
                    }),
                    note: 'Command names are spaced by design (Rule AF). Invoke them with the leading dot, for example `.bank deposit`.'
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_feature_describe',
        {
            description:
                'Describe one Cosmos bot feature in full: canonical spaced invocation, English and Indonesian descriptions, aliases, parameter schema, category, and owner-only status. Also reports any Rule AF or Rule T invariant violation for that feature.',
            inputSchema: {
                name: zod.string(
                    'The feature name or alias, with or without the leading dot, for example "bank deposit".'
                )
            },
            handler: async (args) => {
                const raw = String(args.name ?? '').trim();
                const module = toolsHandler.getTool(raw);
                if (!module) {
                    throw new McpToolError(
                        'NOT_FOUND',
                        `No Cosmos feature matches "${raw}". Use cosmos_feature_list to enumerate the registry.`
                    );
                }
                const definition = module.definition;
                const t = getTranslator('id');
                const tEn = getTranslator('en');

                const violations = checkSpacedCommandName(definition);
                if (!definition.descriptionKey) {
                    violations.push(
                        `${invocationOf(definition)} declares no descriptionKey. Rule T requires tools.commands.<clean_name>.description.`
                    );
                }

                return {
                    ...toSummary(definition),
                    descriptions: {
                        en: resolveToolDescription(definition, tEn),
                        id: resolveToolDescription(definition, t)
                    },
                    ruleViolations: violations
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_feature_invoke',
        {
            description:
                'Validate an intended Cosmos command invocation. Dry-run by default: it resolves the feature, checks the argument arity against the declared parameter schema, verifies the descriptionKey resolves in both English and Indonesian, and reports the permission gate — WITHOUT executing anything. Set execute: true to actually run the handler for the small set of safe operations.',
            mutating: true,
            inputSchema: {
                name: zod.string(
                    'The feature name or alias, with or without the leading dot, for example "bank deposit".'
                ),
                args: zod.optionalRecord('Arguments that would be passed to the feature handler.'),
                argsStr: zod.optionalString(
                    'The raw argument string that follows the command, used for spaced-name longest-prefix resolution.'
                ),
                execute: zod.optionalBoolean('Set true to execute the handler. Defaults to false (validate only).'),
                confirm: zod.optionalBoolean('Required when execute is true, to acknowledge the mutation.')
            },
            handler: async (args, toolDeps) => {
                const raw = String(args.name ?? '').trim();
                const module = toolsHandler.getTool(raw);
                if (!module) {
                    throw new McpToolError(
                        'NOT_FOUND',
                        `No Cosmos feature matches "${raw}". Use cosmos_feature_list to enumerate the registry.`
                    );
                }

                const definition = module.definition;
                const featureArgs = (args.args ?? {}) as Record<string, unknown>;
                const declared = (definition.parameters ?? {}) as {
                    required?: string[];
                    properties?: Record<string, unknown>;
                };
                const required = declared.required ?? [];
                const missing = required.filter((key) => featureArgs[key] === undefined);

                const t = getTranslator('id');
                const tEn = getTranslator('en');
                const descriptionEn = resolveToolDescription(definition, tEn);
                const descriptionId = resolveToolDescription(definition, t);

                const validation = {
                    feature: invocationOf(definition),
                    resolved: true,
                    ownerOnly: definition.owner === true,
                    requiredArguments: required,
                    missingArguments: missing,
                    argumentsValid: missing.length === 0,
                    argsStr: args.argsStr ?? null,
                    descriptionResolved: { en: descriptionEn, id: descriptionId },
                    i18nKeysPresent: Boolean(definition.descriptionKey),
                    ruleViolations: checkSpacedCommandName(definition)
                };

                if (args.execute !== true) {
                    return { executed: false, dryRun: true, validation };
                }

                if (args.confirm !== true) {
                    throw new McpToolError(
                        'CONFIRMATION_REQUIRED',
                        'Executing a Cosmos feature requires confirm: true to acknowledge the mutation.'
                    );
                }
                if (definition.owner === true) {
                    throw new McpToolError(
                        'FORBIDDEN_TABLE',
                        `${invocationOf(definition)} is an owner-only command. Execute it from the owner chat, not through the developer MCP surface.`
                    );
                }

                await recordAudit({
                    identity: toolDeps.identity,
                    tool: 'cosmos_feature_invoke',
                    summary: `Executed ${invocationOf(definition)} with ${Object.keys(featureArgs).length} argument(s).`
                });

                const output = await module.execute(featureArgs, {
                    sock: null as never,
                    msg: null as never,
                    jid: toolDeps.identity.identity,
                    t: t as never,
                    lang: 'id'
                });

                return { executed: true, dryRun: false, validation, output: output ?? null };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_settings_get',
        {
            description:
                'Read the persisted Cosmos runtime configuration from the database rather than from .env on disk: auto-download settings, group NSFW settings, economy multipliers, whitelisted groups, and sub-bot feature flags.',
            inputSchema: {
                scope: zod.literal(
                    ['autoDl', 'groupNsfw', 'economy', 'whitelist', 'subbots'] as const,
                    'Which configuration scope to read.'
                ),
                jid: zod.optionalString('Restrict the result to one JID. Required for the autoDl and groupNsfw scopes.')
            },
            handler: async (args) => {
                const scope = args.scope as 'autoDl' | 'groupNsfw' | 'economy' | 'whitelist' | 'subbots';
                const jid = args.jid as string | undefined;
                const { prisma } = await import('#db.js');

                if (scope === 'autoDl') {
                    if (!jid) throw new McpToolError('INVALID_PAYLOAD', 'A jid is required for the autoDl scope.');
                    const rows = await prisma.autoDlSetting.findMany({ where: { jid } });
                    return {
                        scope,
                        jid,
                        settings: rows.map((row) => ({
                            platform: row.platform,
                            enabled: row.enabled,
                            updatedAt: row.updated_at.toISOString()
                        }))
                    };
                }
                if (scope === 'groupNsfw') {
                    const rows = await prisma.groupNsfwSetting.findMany({
                        where: jid ? { jid } : undefined,
                        take: 200
                    });
                    return {
                        scope,
                        count: rows.length,
                        settings: rows.map((row) => ({
                            jid: row.jid,
                            enabled: row.enabled,
                            updatedBy: row.updatedBy,
                            updatedAt: row.updatedAt.toISOString()
                        }))
                    };
                }
                if (scope === 'economy') {
                    const [latest, history] = await Promise.all([
                        prisma.economyMultiplier.findFirst({ orderBy: { appliedAt: 'desc' } }),
                        prisma.economyMultiplier.findMany({ orderBy: { appliedAt: 'desc' }, take: 10 })
                    ]);
                    return {
                        scope,
                        latest: latest
                            ? {
                                  multiplier: latest.multiplier,
                                  appliedAt: latest.appliedAt.toISOString(),
                                  reasoning: latest.reasoning
                              }
                            : null,
                        history: history.map((row) => ({
                            multiplier: row.multiplier,
                            appliedAt: row.appliedAt.toISOString(),
                            reasoning: row.reasoning
                        }))
                    };
                }
                if (scope === 'whitelist') {
                    const rows = await prisma.whitelistedGroup.findMany({ take: 500, orderBy: { createdAt: 'desc' } });
                    return {
                        scope,
                        count: rows.length,
                        groups: rows.map((row) => ({
                            jid: row.jid,
                            language: row.language,
                            ownerJid: row.ownerJid,
                            createdAt: row.createdAt.toISOString()
                        }))
                    };
                }

                const rows = await prisma.subBotInstance.findMany({ take: 200, orderBy: { createdAt: 'desc' } });
                return {
                    scope,
                    count: rows.length,
                    subBots: rows.map((row) => ({
                        id: row.id,
                        ownerJid: row.ownerJid,
                        status: row.status,
                        customPrefix: row.customPrefix
                    }))
                };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_settings_set',
        {
            description:
                'Update a persisted Cosmos runtime setting through the existing Prisma models rather than by editing .env on disk. Every call is audited to ActivityLog and printed to the console.',
            mutating: true,
            inputSchema: {
                scope: zod.literal(['autoDl', 'groupNsfw'] as const, 'Which configuration scope to update.'),
                jid: zod.string('The JID the setting applies to.'),
                platform: zod.optionalString('Required for the autoDl scope: the download platform identifier.'),
                enabled: zod.boolean('The new boolean value.'),
                confirm: zod.boolean('Required: true to acknowledge the change.')
            },
            handler: async (args, toolDeps) => {
                if (args.confirm !== true) {
                    throw new McpToolError(
                        'CONFIRMATION_REQUIRED',
                        'Updating a Cosmos runtime setting requires confirm: true.'
                    );
                }
                const scope = args.scope as 'autoDl' | 'groupNsfw';
                const jid = String(args.jid ?? '').trim();
                const enabled = args.enabled === true;
                if (!jid) throw new McpToolError('INVALID_PAYLOAD', 'A jid is required.');
                const { prisma } = await import('#db.js');

                if (scope === 'autoDl') {
                    const platform = String(args.platform ?? '').trim();
                    if (!platform)
                        throw new McpToolError('INVALID_PAYLOAD', 'A platform is required for the autoDl scope.');
                    const before = await prisma.autoDlSetting.findUnique({
                        where: { jid_platform: { jid, platform } }
                    });
                    const saved = await prisma.autoDlSetting.upsert({
                        where: { jid_platform: { jid, platform } },
                        create: { jid, platform, enabled },
                        update: { enabled }
                    });
                    await recordAudit({
                        identity: toolDeps.identity,
                        tool: 'cosmos_settings_set',
                        summary: `Set AutoDlSetting ${platform} to ${enabled ? 'enabled' : 'disabled'}.`,
                        diff: { before: before?.enabled ?? null, after: saved.enabled }
                    });
                    return { scope, jid, platform, enabled: saved.enabled, updatedAt: saved.updated_at.toISOString() };
                }

                const before = await prisma.groupNsfwSetting.findUnique({ where: { jid } });
                const saved = await prisma.groupNsfwSetting.upsert({
                    where: { jid },
                    create: { jid, enabled, updatedBy: toolDeps.identity.identity },
                    update: { enabled, updatedBy: toolDeps.identity.identity }
                });
                await recordAudit({
                    identity: toolDeps.identity,
                    tool: 'cosmos_settings_set',
                    summary: `Set GroupNsfwSetting to ${enabled ? 'enabled' : 'disabled'}.`,
                    diff: { before: before?.enabled ?? null, after: saved.enabled }
                });
                return { scope, jid, enabled: saved.enabled, updatedAt: saved.updatedAt.toISOString() };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_i18n_check',
        {
            description:
                'Audit the Cosmos translation catalogues, satisfying AGENTS.md Rule O as a tool call: reports keys present in src/locales/en but missing from src/locales/id, keys missing from English, and interpolation-variable mismatches, per namespace.',
            inputSchema: {
                namespace: zod.optionalString(
                    'Restrict the report to one namespace: core, tools, games, media, or utilities.'
                )
            },
            handler: async (args) => {
                const report = runI18nCheck();
                const namespace = args.namespace as string | undefined;
                const reports = namespace
                    ? report.reports.filter((entry) => entry.namespace === namespace)
                    : report.reports;
                return { ...report, reports, restrictedTo: namespace ?? null };
            }
        },
        deps,
        summary
    );

    registerTool(
        server,
        'cosmos_schema_check',
        {
            description:
                'Run the Cosmos repository governance checks as a machine-verifiable report: Rule W (3-phase DDL ordering and dual maintenance across src/db.ts and .worktrees/api/src/db.ts) and Rule X (worktree isolation in ESLint, Prettier, and Git).',
            inputSchema: {},
            handler: async () => {
                const checks = runSchemaChecks();
                const isolation = runToolingIsolationCheck();
                const catalogue = loadSchemaCatalogue();
                return {
                    ruleW: {
                        pass: checks.migrationOrderValid && checks.mirrorSymmetric && checks.driversComparable,
                        schemaPrisma: checks.schemaPrisma,
                        driversComparable: checks.driversComparable,
                        mirrorSymmetric: checks.mirrorSymmetric,
                        migrationOrderValid: checks.migrationOrderValid,
                        drivers: checks.drivers,
                        findings: checks.findings
                    },
                    ruleX: {
                        pass: isolation.pass,
                        targets: isolation.targets,
                        findings: isolation.findings
                    },
                    modelCount: catalogue?.modelCount ?? 0,
                    pass:
                        checks.migrationOrderValid &&
                        checks.mirrorSymmetric &&
                        checks.driversComparable &&
                        isolation.pass
                };
            }
        },
        deps,
        summary
    );
};
