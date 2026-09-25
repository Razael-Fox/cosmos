import menuService from '../services/menuService.js';
import tutorialService from '../services/tutorialService.js';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { ToolModule, ToolContext } from './types.js';
import { getTranslator } from '../utils/i18n.js';

class ToolsHandler {
    private tools = new Map<string, ToolModule>();
    private aliases = new Map<string, string>();

    private isLoaded = false;

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
                    const normalizedName = name.toLowerCase();
                    this.tools.set(normalizedName, toolModule);
                    if (aliases && Array.isArray(aliases)) {
                        for (const alias of aliases) {
                            const normalizedAlias = alias.toLowerCase();
                            this.aliases.set(normalizedAlias, normalizedName);
                        }
                    }
                }
            } catch (err) {
                console.error(`Failed to load tool ${file}:`, err);
            }
        }
        this.isLoaded = true;
    }

    getTool(nameOrAlias?: string): ToolModule | null {
        if (!nameOrAlias) return null;
        const normalized = nameOrAlias.trim().toLowerCase();
        const undotted = normalized.startsWith('.') ? normalized.slice(1).trim() : normalized;

        // 1. Direct match with raw input or undotted
        if (this.tools.has(normalized)) return this.tools.get(normalized) || null;
        if (this.aliases.has(normalized)) {
            const name = this.aliases.get(normalized)!;
            return this.tools.get(name) || null;
        }

        if (this.tools.has(undotted)) return this.tools.get(undotted) || null;
        if (this.aliases.has(undotted)) {
            const name = this.aliases.get(undotted)!;
            return this.tools.get(name) || null;
        }

        // 2. Normalized matching (hyphens/underscores to spaces)
        const spaceNormalized = undotted.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
        if (this.tools.has(spaceNormalized)) return this.tools.get(spaceNormalized) || null;
        if (this.aliases.has(spaceNormalized)) {
            const name = this.aliases.get(spaceNormalized)!;
            return this.tools.get(name) || null;
        }

        // 3. Stripped matching (no spaces, hyphens, or underscores)
        const stripped = undotted.replace(/[-_\s]+/g, '');
        for (const [toolName, toolModule] of this.tools.entries()) {
            if (toolName.replace(/[-_\s]+/g, '') === stripped) {
                return toolModule;
            }
        }
        for (const [aliasName, toolName] of this.aliases.entries()) {
            if (aliasName.replace(/[-_\s]+/g, '') === stripped) {
                return this.tools.get(toolName) || null;
            }
        }

        return null;
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
            tgadd: true,
            tgdel: true,
            tgpair: true,
            setgrouplang: true,
            setlang: true,
            startautocorrection: true,
            stopautocorrection: true,
            togglesticker: true,
            roulette_start: true,
            roulette_join: true,
            roulette_shoot: true,
            roulette_spin: true,
            roulette_use: true,
            roulette_stats: true,
            roulette_leaderboard: true,
            roulette_cancel: true,
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
