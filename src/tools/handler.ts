import menuService from '../services/menuService.js';
import tutorialService from '../services/tutorialService.js';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { ToolModule, ToolContext } from './types.js';
import { getTranslator } from '../utils/i18n.js';
import { getSenderJid } from '../utils/casino.js';
import { normalizeCommandKey, stripCommandKey } from '../utils/commandNormalize.js';
import { resolveLimit, tryConsume } from '../utils/featureLimiter.js';
import { i18n } from '../locales/i18n.config.js';

class ToolsHandler {
    /** Registry keyed by canonical command key (see normalizeCommandKey). */
    private tools = new Map<string, ToolModule>();
    private aliases = new Map<string, string>();
    /** Fully stripped fallback index, used only when the canonical lookup misses. */
    private strippedIndex = new Map<string, ToolModule>();

    private isLoaded = false;

    /** Per-file import failures from the last loadTools() call, for diagnostics. */
    private loadFailures: Array<{ file: string; error: string }> = [];

    /** Longest registered command name in words; computed once during load. */
    private maxCommandWords = 1;

    /** Number of registered command modules. Zero means the load failed outright. */
    public getToolCount(): number {
        return this.tools.size;
    }

    /** Files that failed to import during the last load, for test diagnostics. */
    public getLoadFailures(): Array<{ file: string; error: string }> {
        return [...this.loadFailures];
    }

    async loadTools(): Promise<void> {
        if (this.isLoaded) return;
        const distToolsPath = path.resolve(process.cwd(), 'dist', 'tools');
        const srcToolsPath = path.resolve(process.cwd(), 'src', 'tools');
        const isTs = import.meta.url.endsWith('.ts');
        const toolsPath =
            isTs && fs.existsSync(srcToolsPath)
                ? srcToolsPath
                : fs.existsSync(distToolsPath)
                  ? distToolsPath
                  : srcToolsPath;

        const files = fs
            .readdirSync(toolsPath)
            .filter(
                (f) =>
                    (f.endsWith('.js') || f.endsWith('.ts')) &&
                    !f.startsWith('handler.') &&
                    !f.startsWith('types.') &&
                    !f.endsWith('.d.ts')
            );
        for (const file of files) {
            try {
                const fileUrl = pathToFileURL(path.join(toolsPath, file)).href;
                const imported = await import(fileUrl);

                // Support both named exports and default export
                const toolModule: ToolModule = imported.default ? imported.default : imported;

                if (toolModule.definition && typeof toolModule.execute === 'function') {
                    const { name, aliases } = toolModule.definition;
                    const normalizedName = normalizeCommandKey(name);
                    this.tools.set(normalizedName, toolModule);
                    this.strippedIndex.set(stripCommandKey(name), toolModule);
                    if (aliases && Array.isArray(aliases)) {
                        for (const alias of aliases) {
                            const normalizedAlias = normalizeCommandKey(alias);
                            this.aliases.set(normalizedAlias, normalizedName);
                            this.strippedIndex.set(stripCommandKey(alias), toolModule);
                        }
                    }
                }
            } catch (err) {
                // A tool that throws on import (missing DB, bad config) must not
                // take the whole registry down, so this stays non-fatal. It is
                // recorded so callers can tell "tool absent" apart from
                // "environment broken" instead of silently probing an empty map.
                const message = err instanceof Error ? err.message : String(err);
                this.loadFailures.push({ file, error: message });
                console.error(`Failed to load tool ${file}:`, err);
            }
        }

        // An empty registry is never legitimate: every deployment has commands.
        // Failing loudly here stops a broken environment (unwritable SQLite path,
        // missing locales) from masquerading as "this command does not exist".
        if (this.tools.size === 0) {
            const detail = this.loadFailures.map((f) => `${f.file}: ${f.error}`).join('; ');
            this.loadFailures = [];
            throw new Error(
                `Tool registry is empty after loading ${files.length} modules. ` +
                    `Every module failed to import${detail ? ` — ${detail}` : ''}.`
            );
        }

        if (this.loadFailures.length > 0) {
            // Pterodactyl console visibility (Rule C): one line, not one per file.
            console.warn(
                `[ToolsHandler] WARNING: ${this.loadFailures.length}/${files.length} tool modules failed to load. ` +
                    `Affected: ${this.loadFailures
                        .slice(0, 10)
                        .map((f) => f.file)
                        .join(', ')}` +
                    `${this.loadFailures.length > 10 ? `, +${this.loadFailures.length - 10} more` : ''}. ` +
                    `First cause: ${this.loadFailures[0]?.file} — ${this.loadFailures[0]?.error}`
            );
        }

        this.isLoaded = true;

        // Cache the vocabulary maximum now that the registry is final, so the
        // message handler never has to re-walk every key while parsing a message.
        let maxWords = 1;
        for (const key of [...this.tools.keys(), ...this.aliases.keys()]) {
            const words = key.split(/\s+/).filter(Boolean).length;
            if (words > maxWords) maxWords = words;
        }
        this.maxCommandWords = maxWords;
    }

    /**
     * Resolves a command name or alias to its tool module.
     *
     * Resolution is fully normalized, so all of the following reach the same tool:
     *   `.menu`, `. menu`, `menu`, `.MENU`, `.  menu`
     *   `.apply-license`, `.apply license`, `.apply_license`, `.applylicense`
     */
    getTool(nameOrAlias?: string): ToolModule | null {
        if (!nameOrAlias) return null;
        const key = normalizeCommandKey(nameOrAlias);
        if (!key) return null;

        // 1. Canonical match against tool names, then aliases.
        const direct = this.tools.get(key);
        if (direct) return direct;
        const aliased = this.aliases.get(key);
        if (aliased) return this.tools.get(aliased) || null;

        // 2. Last-resort stripped match (spaces/hyphens/underscores ignored).
        return this.strippedIndex.get(stripCommandKey(key)) || null;
    }

    /**
     * Returns the canonical registered name of the tool that owns a command,
     * or null when the command does not resolve.
     */
    getCanonicalName(nameOrAlias?: string): string | null {
        const tool = this.getTool(nameOrAlias);
        if (!tool) return null;
        return normalizeCommandKey(tool.definition.name);
    }

    /**
     * The maximum number of whitespace-separated words used by any registered
     * command name or alias, so parsers can bound their longest-prefix scan.
     *
     * Computed once while the registry is populated rather than per message: this
     * sits in the hot parse path and previously walked every tool and alias key
     * on each inbound message.
     *
     * The value is the true vocabulary maximum. `MAX_COMMAND_WORDS` bounds how
     * deep a *caller* may usefully scan, but it must never truncate the
     * discovered maximum — doing so would make an over-long command silently
     * unreachable with no diagnostic instead of merely expensive to match.
     */
    getMaxCommandWords(): number {
        return Math.max(this.maxCommandWords, 1);
    }

    isOwnerOnly(nameOrAlias: string): boolean {
        const tool = this.getTool(nameOrAlias);
        return tool?.definition?.owner === true;
    }

    getAllTools(): ToolModule[] {
        const uniqueTools = new Set<ToolModule>();
        for (const tool of this.tools.values()) {
            uniqueTools.add(tool);
        }
        return Array.from(uniqueTools);
    }
    /**
     * @deprecated Deprecated in favor of CosmosAgentEngine scoped tool registry.
     * Retained only for legacy compatibility.
     */
    getGroqTools(): Array<{
        type: string;
        function: { name: string; description: string; parameters: Record<string, unknown> };
    }> {
        const EXCLUDED_GROQ_TOOLS: Record<string, true> = {
            addbalance: true,
            forceupdate: true,
            config: true,
            subbot: true,
            idcard: true,
            cancel: true,
            transfer: true,
            bank: true,
            loan: true,
            tgpair: true,
            setgrouplang: true,
            setlang: true,
            startautocorrection: true,
            stopautocorrection: true,
            slot: true,
            coinflip: true,
            dice: true,
            property_buy: true,
            property_sell: true,
            shop: true
        };

        const groqTools: Array<{
            type: string;
            function: { name: string; description: string; parameters: Record<string, unknown> };
        }> = [];
        const seenNames = new Set<string>();

        for (const toolModule of this.tools.values()) {
            const def = toolModule.definition;
            if (!def || !def.name) continue;

            const cleanName = def.name.replace(/^[.-]+/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
            if (!cleanName || seenNames.has(cleanName)) continue;
            if (def.owner === true) continue;
            if (EXCLUDED_GROQ_TOOLS[cleanName.toLowerCase()]) continue;

            seenNames.add(cleanName);
            groqTools.push({
                type: 'function',
                function: {
                    name: cleanName,
                    description: def.description || '',
                    parameters: (def.parameters as Record<string, unknown>) || { type: 'object', properties: {} }
                }
            });
        }
        return groqTools;
    }

    private isTutorialRequest(nameOrAlias: string, args: Record<string, any>): boolean {
        const cleanName = nameOrAlias
            .toLowerCase()
            .trim()
            .replace(/^[.-]+/, '');
        if (cleanName === 'help' || cleanName === 'menu') {
            return false;
        }
        if (!args || typeof args !== 'object') return false;
        for (const val of Object.values(args)) {
            if (typeof val === 'string') {
                const trimmed = val.trim().toLowerCase();
                if (trimmed === 'tutorial' || trimmed === 'panduan') {
                    return true;
                }
            }
        }
        return false;
    }

    async execute(nameOrAlias: string, args: Record<string, any>, ctx: ToolContext): Promise<any> {
        const tool = this.getTool(nameOrAlias);
        if (!tool) throw new Error(`Tool not found: ${nameOrAlias}`);
        if (!ctx.t) {
            ctx.t = getTranslator('id');
        }

        // Plan-aware feature limit (docs/FEATURE_LIMITS.md). Single funnel, so the
        // auto-sticker trigger in message.ts is covered without its own call site.
        // A rejected ffmpeg/spawn costs the same CPU as a successful one, so the slot
        // is consumed on the check, before the tool runs.
        // Counted per sender, not per chat: ctx.jid is the group JID inside groups.
        const senderJid = getSenderJid(ctx.msg, ctx.sock) || ctx.jid;
        const resolved = await resolveLimit(tool.definition, senderJid);
        if (resolved && !tryConsume(`${resolved.key}:${senderJid}`, resolved.limit.max, resolved.limit.windowMs)) {
            const minutes = Math.ceil(resolved.limit.windowMs / 60_000);
            const key =
                resolved.tier === 'FREE' && i18n.exists('core.limits.cooldown_free', { lng: ctx.lang || 'id' })
                    ? 'core.limits.cooldown_free'
                    : 'core.limits.cooldown';
            return ctx.t(key, { minutes });
        }

        // Universal Tutorial & Panduan Interception for all related commands & aliases
        if (this.isTutorialRequest(nameOrAlias, args)) {
            const suite = tutorialService.getTutorialForCommand(nameOrAlias);
            if (suite) {
                return menuService.getTutorial(suite.id, ctx.lang || 'id', ctx.t, '.');
            }
        }

        return await tool.execute(args, ctx);
    }
}

const toolsHandler = new ToolsHandler();
export default toolsHandler;
