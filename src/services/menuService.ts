import { ToolModule, resolveToolDescription } from '../tools/types.js';
import toolsHandler from '../tools/handler.js';
import { toDisplayCommand, getDisplayName } from '../utils/commandFormat.js';

export interface NormalizedTool {
    name: string;
    title: string;
    displayNames?: Partial<Record<'en' | 'id', string>>;
    category: string;
    rawCategory: string;
    description: string;
    descriptionKey?: string;
    aliases: string[];
    owner: boolean;
    usage: string;
    example: string;
    parameters?: {
        type: string;
        properties?: Record<string, any>;
        required?: string[];
    };
}

export interface CategoryInfo {
    name: string;
    icon: string;
    count: number;
    commands: NormalizedTool[];
}

export const CANONICAL_CATEGORY_ORDER: readonly string[] = [
    'Casino',
    'Games',
    'Economy & Banking',
    'Employment',
    'Downloaders',
    'Music & Audio',
    'Media & Stickers',
    'AI & Correction',
    'Tools & Utilities',
    'Settings',
    'System & Help'
];

export const CATEGORY_ICONS: Record<string, string> = {
    Casino: '🎰',
    Games: '🎮',
    'Economy & Banking': '💰',
    Employment: '💼',
    Downloaders: '📥',
    'Music & Audio': '🎵',
    'Media & Stickers': '🎨',
    'AI & Correction': '🤖',
    'Tools & Utilities': '🛠️',
    Settings: '⚙️',
    'System & Help': 'ℹ️'
};

const CATEGORY_MAP: Record<string, string> = {
    casino: 'Casino',
    games: 'Games',
    game: 'Games',
    economy: 'Economy & Banking',
    banking: 'Economy & Banking',
    'economy & banking': 'Economy & Banking',
    employment: 'Employment',
    licensing: 'Employment',
    downloaders: 'Downloaders',
    downloader: 'Downloaders',
    'music & audio': 'Music & Audio',
    'music & lyrics': 'Music & Audio',
    music: 'Music & Audio',
    'media & stickers': 'Media & Stickers',
    stickers: 'Media & Stickers',
    media: 'Media & Stickers',
    'ai & correction': 'AI & Correction',
    ai: 'AI & Correction',
    'tools & utilities': 'Tools & Utilities',
    tools: 'Tools & Utilities',
    utilities: 'Tools & Utilities',
    settings: 'Settings',
    setting: 'Settings',
    general: 'System & Help',
    'system & help': 'System & Help',
    system: 'System & Help',
    help: 'System & Help'
};

export class MenuService {
    private cachedTools: NormalizedTool[] | null = null;

    /**
     * Clears internal cache of normalized tools.
     */
    public clearCache(): void {
        this.cachedTools = null;
    }

    /**
     * Consolidates micro-categories into unified canonical categories.
     */
    public normalizeCategory(category?: string): string {
        if (!category) return 'System & Help';
        const trimmed = category.trim();
        const lower = trimmed.toLowerCase();
        return CATEGORY_MAP[lower] || trimmed;
    }

    /**
     * Gets the associated emoji icon for a category.
     */
    public getCategoryIcon(categoryName: string): string {
        const canonical = this.normalizeCategory(categoryName);
        return CATEGORY_ICONS[canonical] || '📌';
    }

    private cachedToolsByLang = new Map<string, NormalizedTool[]>();

    /**
     * Normalizes a raw array of ToolModules into structured NormalizedTools.
     */
    public processTools(rawTools: ToolModule[], lang: string = 'id'): NormalizedTool[] {
        const normalized: NormalizedTool[] = [];
        const seenNames = new Set<string>();

        for (const tool of rawTools) {
            const def = tool.definition;
            if (!def || !def.name) continue;
            const nameLower = def.name.toLowerCase();
            if (seenNames.has(nameLower)) continue;
            seenNames.add(nameLower);

            const canonicalCategory = this.normalizeCategory(def.category);

            // Special handling for idcard: separate registration and lookup parent entries
            if (nameLower === 'idcard') {
                const regName = lang === 'id' ? 'buat ktp' : 'register id';
                const regTitle = lang === 'id' ? 'Buat KTP Virtual' : 'Virtual ID Card Registration';
                const regDesc =
                    lang === 'id'
                        ? 'Daftarkan identitas KTP Virtual baru.'
                        : 'Register a new Virtual ID Card identity.';
                normalized.push({
                    name: regName,
                    title: regTitle,
                    displayNames: { en: 'register id', id: 'buat ktp' },
                    category: canonicalCategory,
                    rawCategory: def.category || 'General',
                    description: regDesc,
                    descriptionKey: def.descriptionKey,
                    aliases: ['.register id', '.daftar id', '.daftar ktp', '.buat ktp', '.register-id', '.registerid'],
                    owner: Boolean(def.owner),
                    usage: `.${regName} [photo]`,
                    example: `.${regName}`,
                    parameters: def.parameters
                });

                const lookupName = lang === 'id' ? 'cek ktp' : 'check id';
                const lookupTitle = lang === 'id' ? 'Cek KTP Virtual' : 'Virtual ID Card Lookup';
                const lookupDesc =
                    lang === 'id' ? 'Lihat KTP Virtual yang sudah terdaftar.' : 'View your registered Virtual ID Card.';
                normalized.push({
                    name: lookupName,
                    title: lookupTitle,
                    displayNames: { en: 'check id', id: 'cek ktp' },
                    category: canonicalCategory,
                    rawCategory: def.category || 'General',
                    description: lookupDesc,
                    descriptionKey: def.descriptionKey,
                    aliases: [
                        '.check id',
                        '.cek id',
                        '.cek ktp',
                        '.lihat ktp',
                        '.check-id',
                        '.ktp',
                        '.myid',
                        '.idcard'
                    ],
                    owner: Boolean(def.owner),
                    usage: `.${lookupName}`,
                    example: `.${lookupName}`,
                    parameters: def.parameters
                });
                continue;
            }

            const displayName = getDisplayName(def, lang);

            // Normalize aliases: ensure every alias starts with a dot
            const rawAliases = Array.isArray(def.aliases) ? def.aliases : [];
            const normalizedAliases = Array.from(
                new Set(
                    rawAliases
                        .map((a) => a.trim())
                        .filter((a) => a.length > 0)
                        .map((a) => (a.startsWith('.') ? a : `.${a}`))
                )
            );

            // Ensure canonical space-separated display name and any localized variants are in aliases
            normalizedAliases.push(`.${displayName}`);
            normalizedAliases.push(`.${toDisplayCommand(def.name)}`);
            if (def.displayNames?.en) {
                normalizedAliases.push(`.${toDisplayCommand(def.displayNames.en)}`);
            }
            if (def.displayNames?.id) {
                normalizedAliases.push(`.${toDisplayCommand(def.displayNames.id)}`);
            }

            // Extract usage and example from description if present
            let description = def.description || '';
            let example = '';
            let usage = '';

            const exampleMatch = description.match(/Example:\s*(.+)$/i);
            if (exampleMatch) {
                example = exampleMatch[1].trim();
                description = description.replace(/Example:\s*(.+)$/i, '').trim();
            }

            const usageMatch = description.match(/Usage:\s*(.+)$/i);
            if (usageMatch) {
                usage = usageMatch[1].trim();
                description = description.replace(/Usage:\s*(.+)$/i, '').trim();
            }

            if (!usage) {
                if (def.parameters?.properties) {
                    const props = Object.keys(def.parameters.properties);
                    const required = new Set(def.parameters.required || []);
                    if (props.length > 0) {
                        const paramStr = props.map((p) => (required.has(p) ? `<${p}>` : `[${p}]`)).join(' ');
                        usage = `.${displayName} ${paramStr}`;
                    } else {
                        usage = `.${displayName}`;
                    }
                } else {
                    usage = `.${displayName}`;
                }
            } else {
                usage = usage.replace(`.${def.name}`, `.${displayName}`);
            }

            if (!example && usage) {
                example = usage;
            } else if (example) {
                example = example.replace(`.${def.name}`, `.${displayName}`);
            }

            normalized.push({
                name: displayName,
                title: def.title || def.name,
                displayNames: def.displayNames,
                category: canonicalCategory,
                rawCategory: def.category || 'General',
                description,
                descriptionKey: def.descriptionKey,
                aliases: Array.from(new Set(normalizedAliases)),
                owner: Boolean(def.owner),
                usage,
                example,
                parameters: def.parameters
            });
        }

        return normalized;
    }

    /**
     * Resolves the localized description of a tool using the provided translator.
     */
    public getToolDescription(tool: NormalizedTool, t?: (key: string, args?: Record<string, any>) => string): string {
        return resolveToolDescription(tool, t);
    }

    /**
     * Retrieves all normalized tools, using cache when available.
     */
    public getTools(customTools?: ToolModule[], lang: string = 'id'): NormalizedTool[] {
        if (customTools) {
            return this.processTools(customTools, lang);
        }
        if (!this.cachedToolsByLang.has(lang)) {
            const raw = toolsHandler.getAllTools();
            this.cachedToolsByLang.set(lang, this.processTools(raw, lang));
        }
        return this.cachedToolsByLang.get(lang)!;
    }

    /**
     * Aggregates tools into canonical categories with counts and icons.
     */
    public getCategoryList(customTools?: ToolModule[], lang: string = 'id'): CategoryInfo[] {
        const tools = this.getTools(customTools, lang);
        const groupMap = new Map<string, NormalizedTool[]>();

        for (const tool of tools) {
            if (!groupMap.has(tool.category)) {
                groupMap.set(tool.category, []);
            }
            groupMap.get(tool.category)!.push(tool);
        }

        const categoryList: CategoryInfo[] = [];

        // 1. Add canonical categories in predefined order
        for (const catName of CANONICAL_CATEGORY_ORDER) {
            const cmds = groupMap.get(catName) || [];
            if (cmds.length > 0) {
                categoryList.push({
                    name: catName,
                    icon: this.getCategoryIcon(catName),
                    count: cmds.length,
                    commands: cmds
                });
                groupMap.delete(catName);
            }
        }

        // 2. Add any remaining non-canonical categories sorted alphabetically
        const remainingKeys = Array.from(groupMap.keys()).sort();
        for (const remName of remainingKeys) {
            const cmds = groupMap.get(remName) || [];
            if (cmds.length > 0) {
                categoryList.push({
                    name: remName,
                    icon: this.getCategoryIcon(remName),
                    count: cmds.length,
                    commands: cmds
                });
            }
        }

        return categoryList;
    }

    /**
     * Gets all tools belonging to a specific category.
     */
    public getCommandsByCategory(
        categoryName: string,
        customTools?: ToolModule[],
        lang: string = 'id'
    ): NormalizedTool[] {
        const canonical = this.normalizeCategory(categoryName);
        const categories = this.getCategoryList(customTools, lang);
        const matched = categories.find((c) => c.name.toLowerCase() === canonical.toLowerCase());
        return matched ? matched.commands : [];
    }

    /**
     * Finds a single command by name or alias (with or without leading dot).
     */
    public findCommand(query: string, customTools?: ToolModule[], lang: string = 'id'): NormalizedTool | null {
        if (!query) return null;
        const clean = query.trim().toLowerCase();
        const undotted = clean.startsWith('.') ? clean.slice(1).trim() : clean;
        const dotted = clean.startsWith('.') ? clean : `.${clean}`;

        const tools = this.getTools(customTools, lang);

        // 1. Exact match on tool name or dotted tool name
        const byName = tools.find((t) => t.name.toLowerCase() === undotted || `.${t.name.toLowerCase()}` === dotted);
        if (byName) return byName;

        // 2. Match on displayNames in either language
        const byDisplayName = tools.find((t) => {
            const en = t.displayNames?.en?.toLowerCase();
            const id = t.displayNames?.id?.toLowerCase();
            return (en && (en === undotted || `.${en}` === dotted)) || (id && (id === undotted || `.${id}` === dotted));
        });
        if (byDisplayName) return byDisplayName;

        // 3. Match in aliases
        const byAlias = tools.find((t) =>
            t.aliases.some((a) => {
                const aLower = a.toLowerCase();
                return aLower === dotted || aLower.replace(/^\./, '').trim() === undotted;
            })
        );
        if (byAlias) return byAlias;

        // 4. Normalized match (converting hyphens and underscores to spaces)
        const spaceNormalized = undotted.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
        const stripped = undotted.replace(/[-_\s]+/g, '');

        const byNormalized = tools.find((t) => {
            const tName = t.name.toLowerCase();
            const tSpace = tName.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
            const tStripped = tName.replace(/[-_\s]+/g, '');
            if (tSpace === spaceNormalized || tStripped === stripped) return true;

            const en = t.displayNames?.en?.toLowerCase();
            if (
                en &&
                (en.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ') === spaceNormalized ||
                    en.replace(/[-_\s]+/g, '') === stripped)
            )
                return true;

            const id = t.displayNames?.id?.toLowerCase();
            if (
                id &&
                (id.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ') === spaceNormalized ||
                    id.replace(/[-_\s]+/g, '') === stripped)
            )
                return true;

            return t.aliases.some((a) => {
                const aClean = a.toLowerCase().replace(/^\./, '').trim();
                const aSpace = aClean.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
                const aStripped = aClean.replace(/[-_\s]+/g, '');
                return aSpace === spaceNormalized || aStripped === stripped;
            });
        });
        if (byNormalized) return byNormalized;

        return null;
    }

    /**
     * Finds a category by exact or partial name.
     */
    public findCategory(query: string, customTools?: ToolModule[], lang: string = 'id'): CategoryInfo | null {
        if (!query) return null;
        const clean = query.trim().toLowerCase();
        const canonical = this.normalizeCategory(clean);
        const categories = this.getCategoryList(customTools, lang);

        // 1. Exact canonical match
        const exactCanonical = categories.find((c) => c.name.toLowerCase() === canonical.toLowerCase());
        if (exactCanonical) return exactCanonical;

        // 2. Exact match against category names
        const exact = categories.find((c) => c.name.toLowerCase() === clean);
        if (exact) return exact;

        // 3. Substring match
        const substring = categories.find((c) => c.name.toLowerCase().includes(clean));
        if (substring) return substring;

        return null;
    }

    /**
     * Returns total command and category statistics.
     */
    public getCatalogStats(
        customTools?: ToolModule[],
        lang: string = 'id'
    ): { totalCommands: number; totalCategories: number } {
        const categories = this.getCategoryList(customTools, lang);
        const totalCommands = categories.reduce((acc, cat) => acc + cat.count, 0);
        return {
            totalCommands,
            totalCategories: categories.length
        };
    }

    /**
     * Returns all tools grouped by category name.
     */
    public getAllGroupedCommands(customTools?: ToolModule[], lang: string = 'id'): Record<string, NormalizedTool[]> {
        const categories = this.getCategoryList(customTools, lang);
        const record: Record<string, NormalizedTool[]> = {};
        for (const cat of categories) {
            record[cat.name] = cat.commands;
        }
        return record;
    }
}

const menuService = new MenuService();
export default menuService;
