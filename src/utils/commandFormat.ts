/**
 * Command Formatting and Normalization Utilities.
 * Handles space-separated display normalization, localized parent command titles,
 * and legacy command deprecation mappings.
 */

export interface CommandDisplayHolder {
    name: string;
    displayNames?: Partial<Record<'en' | 'id', string>>;
}

/**
 * Normalizes command names into canonical space-separated display form.
 * Replaces consecutive hyphens and underscores with single spaces.
 */
export function toDisplayCommand(name: string): string {
    return name.replace(/[-_]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Resolves the localized display name for a command based on the resolved language.
 * Falls back to English canonical display name or the tool definition name.
 */
export function getDisplayName(tool: CommandDisplayHolder, lang: string = 'id'): string {
    const resolvedLang = (lang === 'en' ? 'en' : 'id') as 'en' | 'id';
    const localizedName = tool.displayNames?.[resolvedLang] ?? tool.displayNames?.en ?? tool.name;
    return toDisplayCommand(localizedName);
}

/**
 * Legacy command aliases that trigger deprecation notices.
 * Maps legacy trigger tokens (without leading dot) to their canonical space form.
 */
export const LEGACY_COMMAND_MAP: Record<string, string> = {
    'register-id': '.register id',
    registerid: '.register id',
    'check-id': '.check id',
    'apply-license': '.apply license',
    applylicense: '.apply license',
    'apply-job': '.apply job',
    applyjob: '.apply job',
    addbalance: '.add balance',
    'add-balance': '.add balance',
    topglobal: '.top global',
    'top-global': '.top global',
    fevertime: '.fever time',
    'fever-time': '.fever time',
    myplan: '.my plan',
    'my-plan': '.my plan',
    checkplan: '.check plan',
    'check-plan': '.check plan',
    myquota: '.my quota',
    'my-quota': '.my quota',
    checkquota: '.check quota',
    'check-quota': '.check quota',
    myprofile: '.my profile',
    'my-profile': '.my profile',
    autoarchive: '.auto archive',
    'auto-archive': '.auto archive',
    setlang: '.set lang',
    'set-lang': '.set lang',
    setgrouplang: '.set group lang',
    'setgroup-lang': '.set group lang',
    'set-group-lang': '.set group lang',
    daily: '.daily claim',
    buy: '.shop buy',
    sell: '.property sell',
    catalog: '.property catalog',
    inventory: '.property inventory',
    creategame: '.create game',
    'create-game': '.create game',
    joingame: '.join game',
    'join-game': '.join game',
    startgame: '.start game',
    'start-game': '.start game',
    tgadd: '.tg add',
    'tg-add': '.tg add',
    tgdel: '.tg del',
    'tg-del': '.tg del',
    tglist: '.tg list',
    'tg-list': '.tg list',
    autodl: '.auto dl',
    'auto-dl': '.auto dl',
    tiktokdl: '.tiktok dl',
    'tiktok-dl': '.tiktok dl',
    ytdl: '.yt dl',
    'yt-dl': '.yt dl',
    pinterestdl: '.pinterest dl',
    'pinterest-dl': '.pinterest dl',
    telegramdl: '.telegram dl',
    'telegram-dl': '.telegram dl',
    startautocorrection: '.start autocorrect',
    'start-autocorrection': '.start autocorrect',
    'start-autocorrect': '.start autocorrect',
    stopautocorrection: '.stop autocorrect',
    'stop-autocorrection': '.stop autocorrect',
    'stop-autocorrect': '.stop autocorrect',
    toggleautocorrection: '.toggle autocorrect',
    'toggle-autocorrection': '.toggle autocorrect',
    'toggle-autocorrect': '.toggle autocorrect',
    toggleofflineai: '.toggle offline ai',
    'toggle-offline-ai': '.toggle offline ai',
    whitelistall: '.whitelist all',
    'whitelist-all': '.whitelist all',
    addgroup: '.group add',
    'add-group': '.group add',
    delgroup: '.group del',
    'del-group': '.group del'
};

/**
 * Determines whether a given command token is a legacy command and returns its canonical form.
 */
export function getLegacyCanonical(commandName: string): string | null {
    const clean = commandName.trim().replace(/^\./, '').toLowerCase();
    return LEGACY_COMMAND_MAP[clean] || null;
}
