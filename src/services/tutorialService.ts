export interface TutorialStep {
    titleKey: string;
    bodyKey: string;
}

export interface TutorialDefinition {
    id: string; // Unique topic identifier (e.g. 'bank', 'casino')
    category: string; // Associated canonical category
    titleKey: string; // Localization key for card header
    prerequisiteKeys?: string[]; // Requirements (e.g. Virtual ID Card, Cash, Admin)
    aliases: string[]; // Aliases & commands that route here (both EN & ID)
    relatedCommands: string[]; // Covered tool names & command aliases
    localizedRelatedCommands?: {
        en: string[];
        id: string[];
    };
    steps: TutorialStep[]; // Sequential step guides
    footerKey?: string; // Final tip or warning key
}

export const TUTORIAL_SUITES: TutorialDefinition[] = [
    {
        id: 'bank',
        category: 'Banking',
        titleKey: 'tools.tutorials.bank.header',
        prerequisiteKeys: ['tools.tutorials.bank.prereq'],
        aliases: [
            'bank',
            'atm',
            'rekening',
            'transfer',
            'tf',
            'centralbank',
            'deposit',
            'withdraw',
            'depo',
            'wd',
            'setor',
            'tarik'
        ],
        relatedCommands: ['bank', 'transfer'],
        localizedRelatedCommands: {
            en: ['bank', 'transfer'],
            id: ['bank', 'transfer', 'rekening']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.bank.step1_title',
                bodyKey: 'tools.tutorials.bank.step1_body'
            },
            {
                titleKey: 'tools.tutorials.bank.step2_title',
                bodyKey: 'tools.tutorials.bank.step2_body'
            },
            {
                titleKey: 'tools.tutorials.bank.step3_title',
                bodyKey: 'tools.tutorials.bank.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.bank.footer'
    },
    {
        id: 'loan',
        category: 'Banking',
        titleKey: 'tools.tutorials.loan.header',
        prerequisiteKeys: ['tools.tutorials.loan.prereq'],
        aliases: ['loan', 'pinjam', 'pinjaman', 'hutang', 'credit', 'kredit'],
        relatedCommands: ['loan'],
        localizedRelatedCommands: {
            en: ['loan'],
            id: ['loan', 'pinjaman']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.loan.step1_title',
                bodyKey: 'tools.tutorials.loan.step1_body'
            },
            {
                titleKey: 'tools.tutorials.loan.step2_title',
                bodyKey: 'tools.tutorials.loan.step2_body'
            },
            {
                titleKey: 'tools.tutorials.loan.step3_title',
                bodyKey: 'tools.tutorials.loan.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.loan.footer'
    },
    {
        id: 'job',
        category: 'Economy',
        titleKey: 'tools.tutorials.job.header',
        prerequisiteKeys: ['tools.tutorials.job.prereq'],
        aliases: ['job', 'work', 'kerja', 'shift', 'sim', 'license', 'apply license', 'apply_license', 'pekerjaan'],
        relatedCommands: ['job', 'work', 'apply license'],
        localizedRelatedCommands: {
            en: ['job', 'work', 'apply license'],
            id: ['job', 'work', 'apply license', 'kerja', 'shift']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.job.step1_title',
                bodyKey: 'tools.tutorials.job.step1_body'
            },
            {
                titleKey: 'tools.tutorials.job.step2_title',
                bodyKey: 'tools.tutorials.job.step2_body'
            },
            {
                titleKey: 'tools.tutorials.job.step3_title',
                bodyKey: 'tools.tutorials.job.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.job.footer'
    },
    {
        id: 'casino',
        category: 'Casino',
        titleKey: 'tools.tutorials.casino.header',
        prerequisiteKeys: ['tools.tutorials.casino.prereq'],
        aliases: [
            'casino',
            'judi',
            'slot',
            'coinflip',
            'dice',
            'daily',
            'fevertime',
            'vault',
            'balance',
            'bal',
            'saldo',
            'brankas',
            'top',
            'topglobal',
            'top global',
            'addbalance',
            'add balance',
            'fever time'
        ],
        relatedCommands: [
            'slot',
            'coinflip',
            'dice',
            'daily',
            'fever time',
            'vault',
            'balance',
            'add balance',
            'top',
            'top global'
        ],
        localizedRelatedCommands: {
            en: ['slot', 'coinflip', 'dice', 'daily', 'vault', 'balance'],
            id: ['slot', 'coinflip', 'dice', 'daily', 'brankas', 'saldo', 'judi']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.casino.step1_title',
                bodyKey: 'tools.tutorials.casino.step1_body'
            },
            {
                titleKey: 'tools.tutorials.casino.step2_title',
                bodyKey: 'tools.tutorials.casino.step2_body'
            },
            {
                titleKey: 'tools.tutorials.casino.step3_title',
                bodyKey: 'tools.tutorials.casino.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.casino.footer'
    },
    {
        id: 'roulette',
        category: 'Casino',
        titleKey: 'tools.tutorials.roulette.header',
        prerequisiteKeys: ['tools.tutorials.roulette.prereq'],
        aliases: [
            'roulette',
            'buckshot',
            'creategame',
            'joingame',
            'startgame',
            'shoot',
            'use',
            'bet',
            'tembak',
            'russianroulette'
        ],
        relatedCommands: ['creategame', 'joingame', 'startgame', 'shoot', 'use', 'bet'],
        localizedRelatedCommands: {
            en: ['creategame', 'joingame', 'startgame', 'shoot', 'use', 'bet'],
            id: ['creategame', 'joingame', 'startgame', 'shoot', 'use', 'bet']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.roulette.step1_title',
                bodyKey: 'tools.tutorials.roulette.step1_body'
            },
            {
                titleKey: 'tools.tutorials.roulette.step2_title',
                bodyKey: 'tools.tutorials.roulette.step2_body'
            },
            {
                titleKey: 'tools.tutorials.roulette.step3_title',
                bodyKey: 'tools.tutorials.roulette.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.roulette.footer'
    },
    {
        id: 'subbot',
        category: 'Tools',
        titleKey: 'tools.tutorials.subbot.header',
        prerequisiteKeys: ['tools.tutorials.subbot.prereq'],
        aliases: ['subbot', 'jadibot', 'clone', 'config', 'sub_bot', 'sub-bot'],
        relatedCommands: ['subbot', 'config'],
        localizedRelatedCommands: {
            en: ['subbot', 'config'],
            id: ['subbot', 'jadibot', 'config']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.subbot.step1_title',
                bodyKey: 'tools.tutorials.subbot.step1_body'
            },
            {
                titleKey: 'tools.tutorials.subbot.step2_title',
                bodyKey: 'tools.tutorials.subbot.step2_body'
            },
            {
                titleKey: 'tools.tutorials.subbot.step3_title',
                bodyKey: 'tools.tutorials.subbot.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.subbot.footer'
    },
    {
        id: 'idcard',
        category: 'Utility',
        titleKey: 'tools.tutorials.idcard.header',
        prerequisiteKeys: ['tools.tutorials.idcard.prereq'],
        aliases: ['idcard', 'ktp', 'register id', 'check id', 'identitas', 'cancel', 'batal', 'profile', 'profil'],
        relatedCommands: ['idcard', 'cancel', 'profile'],
        localizedRelatedCommands: {
            en: ['idcard', 'cancel', 'profile'],
            id: ['idcard', 'ktp', 'batal', 'profil']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.idcard.step1_title',
                bodyKey: 'tools.tutorials.idcard.step1_body'
            },
            {
                titleKey: 'tools.tutorials.idcard.step2_title',
                bodyKey: 'tools.tutorials.idcard.step2_body'
            },
            {
                titleKey: 'tools.tutorials.idcard.step3_title',
                bodyKey: 'tools.tutorials.idcard.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.idcard.footer'
    },
    {
        id: 'sticker',
        category: 'Media',
        titleKey: 'tools.tutorials.sticker.header',
        prerequisiteKeys: ['tools.tutorials.sticker.prereq'],
        aliases: ['sticker', 'stiker', 'brat', 'stickerly', 'spack', 'sticker_maker', 's'],
        relatedCommands: ['sticker_maker', 'stickerly', 'brat'],
        localizedRelatedCommands: {
            en: ['sticker', 'stickerly', 'brat'],
            id: ['stiker', 'stickerly', 'brat']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.sticker.step1_title',
                bodyKey: 'tools.tutorials.sticker.step1_body'
            },
            {
                titleKey: 'tools.tutorials.sticker.step2_title',
                bodyKey: 'tools.tutorials.sticker.step2_body'
            },
            {
                titleKey: 'tools.tutorials.sticker.step3_title',
                bodyKey: 'tools.tutorials.sticker.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.sticker.footer'
    },
    {
        id: 'downloader',
        category: 'Downloader',
        titleKey: 'tools.tutorials.downloader.header',
        prerequisiteKeys: ['tools.tutorials.downloader.prereq'],
        aliases: [
            'downloader',
            'download',
            'tiktok',
            'tiktokdl',
            'tt',
            'ytdl',
            'youtube',
            'yt',
            'pinterest',
            'pinterestdl',
            'pin',
            'telegram',
            'telegramdl',
            'tg',
            'tgadd',
            'tglist',
            'tgdel',
            'unduh'
        ],
        relatedCommands: ['tiktokdl', 'ytdl', 'pinterestdl', 'telegramdl', 'tgadd', 'tglist', 'tgdel'],
        localizedRelatedCommands: {
            en: ['tiktokdl', 'ytdl', 'pinterestdl', 'telegramdl', 'tgadd'],
            id: ['tiktokdl', 'ytdl', 'pinterestdl', 'telegramdl', 'tgadd', 'unduh']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.downloader.step1_title',
                bodyKey: 'tools.tutorials.downloader.step1_body'
            },
            {
                titleKey: 'tools.tutorials.downloader.step2_title',
                bodyKey: 'tools.tutorials.downloader.step2_body'
            },
            {
                titleKey: 'tools.tutorials.downloader.step3_title',
                bodyKey: 'tools.tutorials.downloader.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.downloader.footer'
    },
    {
        id: 'ai',
        category: 'AI',
        titleKey: 'tools.tutorials.ai.header',
        prerequisiteKeys: ['tools.tutorials.ai.prereq'],
        aliases: [
            'ai',
            'sara',
            'stt',
            'autocorrect',
            'autocorrection',
            'offlineai',
            'startautocorrection',
            'stopautocorrection',
            'toggleautocorrection',
            'toggleofflineai',
            'contact',
            'kontak'
        ],
        relatedCommands: [
            'sara',
            'stt',
            'startautocorrection',
            'stopautocorrection',
            'toggleautocorrection',
            'toggleofflineai',
            'contact'
        ],
        localizedRelatedCommands: {
            en: ['sara', 'stt', 'contact', 'startautocorrection'],
            id: ['sara', 'stt', 'kontak', 'startautocorrection']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.ai.step1_title',
                bodyKey: 'tools.tutorials.ai.step1_body'
            },
            {
                titleKey: 'tools.tutorials.ai.step2_title',
                bodyKey: 'tools.tutorials.ai.step2_body'
            },
            {
                titleKey: 'tools.tutorials.ai.step3_title',
                bodyKey: 'tools.tutorials.ai.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.ai.footer'
    },
    {
        id: 'market',
        category: 'Economy',
        titleKey: 'tools.tutorials.market.header',
        prerequisiteKeys: ['tools.tutorials.market.prereq'],
        aliases: [
            'market',
            'property',
            'shop',
            'catalog',
            'buy',
            'sell',
            'inventory',
            'inv',
            'forceupdate',
            'pasar',
            'properti',
            'toko',
            'katalog',
            'beli',
            'jual',
            'inventori'
        ],
        relatedCommands: ['market', 'shop', 'catalog', 'buy', 'sell', 'inventory', 'forceupdate'],
        localizedRelatedCommands: {
            en: ['market', 'shop', 'catalog', 'buy', 'sell', 'inventory'],
            id: ['market', 'shop', 'catalog', 'beli', 'jual', 'inventory', 'pasar']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.market.step1_title',
                bodyKey: 'tools.tutorials.market.step1_body'
            },
            {
                titleKey: 'tools.tutorials.market.step2_title',
                bodyKey: 'tools.tutorials.market.step2_body'
            },
            {
                titleKey: 'tools.tutorials.market.step3_title',
                bodyKey: 'tools.tutorials.market.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.market.footer'
    },
    {
        id: 'music',
        category: 'Media',
        titleKey: 'tools.tutorials.music.header',
        prerequisiteKeys: ['tools.tutorials.music.prereq'],
        aliases: ['music', 'play', 'lyrics', 'lirik', 'musik', 'lagu', 'putar'],
        relatedCommands: ['play'],
        localizedRelatedCommands: {
            en: ['play'],
            id: ['play', 'musik', 'lagu']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.music.step1_title',
                bodyKey: 'tools.tutorials.music.step1_body'
            },
            {
                titleKey: 'tools.tutorials.music.step2_title',
                bodyKey: 'tools.tutorials.music.step2_body'
            },
            {
                titleKey: 'tools.tutorials.music.step3_title',
                bodyKey: 'tools.tutorials.music.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.music.footer'
    },
    {
        id: 'moderation',
        category: 'Moderation',
        titleKey: 'tools.tutorials.moderation.header',
        prerequisiteKeys: ['tools.tutorials.moderation.prereq'],
        aliases: [
            'moderation',
            'settings',
            'nsfw',
            'rule34',
            'r34',
            'hentai',
            'autodl',
            'grouplang',
            'setgrouplang',
            'setlang',
            'rvo',
            'quoted',
            'getprofilephoto',
            'moderasi',
            'pengaturan'
        ],
        relatedCommands: [
            'rule34',
            'togglensfw',
            'autodl',
            'setgrouplang',
            'setlang',
            'rvo',
            'quoted',
            'getprofilephoto'
        ],
        localizedRelatedCommands: {
            en: ['rule34', 'togglensfw', 'autodl', 'setlang', 'rvo'],
            id: ['rule34', 'togglensfw', 'autodl', 'setlang', 'setgrouplang', 'rvo']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.moderation.step1_title',
                bodyKey: 'tools.tutorials.moderation.step1_body'
            },
            {
                titleKey: 'tools.tutorials.moderation.step2_title',
                bodyKey: 'tools.tutorials.moderation.step2_body'
            },
            {
                titleKey: 'tools.tutorials.moderation.step3_title',
                bodyKey: 'tools.tutorials.moderation.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.moderation.footer'
    },
    {
        id: 'system',
        category: 'System',
        titleKey: 'tools.tutorials.system.header',
        prerequisiteKeys: ['tools.tutorials.system.prereq'],
        aliases: [
            'system',
            'sysinfo',
            'system_info',
            'whitelist',
            'verify',
            'myplan',
            'my plan',
            'sub',
            'subscription',
            'quota',
            'help',
            'menu',
            'bantuan',
            'sistem',
            'verifikasi',
            'paket',
            'kuota',
            'autoarchive',
            'auto archive',
            'archive'
        ],
        relatedCommands: ['system_info', 'help', 'menu', 'whitelist', 'verify', 'my plan', 'subscription', 'quota'],
        localizedRelatedCommands: {
            en: ['system_info', 'help', 'menu', 'my plan', 'subscription', 'quota', 'whitelist', 'verify'],
            id: ['system_info', 'help', 'menu', 'my plan', 'sub', 'quota', 'whitelist', 'verifikasi']
        },
        steps: [
            {
                titleKey: 'tools.tutorials.system.step1_title',
                bodyKey: 'tools.tutorials.system.step1_body'
            },
            {
                titleKey: 'tools.tutorials.system.step2_title',
                bodyKey: 'tools.tutorials.system.step2_body'
            },
            {
                titleKey: 'tools.tutorials.system.step3_title',
                bodyKey: 'tools.tutorials.system.step3_body'
            }
        ],
        footerKey: 'tools.tutorials.system.footer'
    }
];

export class TutorialService {
    private suites: TutorialDefinition[] = TUTORIAL_SUITES;
    private aliasMap: Map<string, TutorialDefinition> = new Map();
    private commandMap: Map<string, TutorialDefinition> = new Map();

    constructor(customSuites?: TutorialDefinition[]) {
        if (customSuites) {
            this.suites = customSuites;
        }
        this.indexSuites();
    }

    private normalizeKey(key: string): string {
        return key
            .toLowerCase()
            .trim()
            .replace(/^[.-]+/, '')
            .replace(/[-_\s]+/g, '');
    }

    private indexSuites(): void {
        this.aliasMap.clear();
        this.commandMap.clear();

        for (const suite of this.suites) {
            // Index id
            const normId = this.normalizeKey(suite.id);
            this.aliasMap.set(normId, suite);

            // Index all aliases
            for (const alias of suite.aliases) {
                const normAlias = this.normalizeKey(alias);
                this.aliasMap.set(normAlias, suite);
            }

            // Index all related commands
            for (const cmd of suite.relatedCommands) {
                const normCmd = this.normalizeKey(cmd);
                this.commandMap.set(normCmd, suite);
                this.aliasMap.set(normCmd, suite);
            }

            // Index localized commands if available
            if (suite.localizedRelatedCommands) {
                const enCmds = suite.localizedRelatedCommands.en || [];
                const idCmds = suite.localizedRelatedCommands.id || [];
                for (const cmd of [...enCmds, ...idCmds]) {
                    const normCmd = this.normalizeKey(cmd);
                    this.commandMap.set(normCmd, suite);
                    this.aliasMap.set(normCmd, suite);
                }
            }
        }
    }

    public getAllSuites(): TutorialDefinition[] {
        return this.suites;
    }

    /**
     * Resolves a tutorial suite by topic, alias, command name, or localized keyword.
     */
    public resolveTutorial(query: string): TutorialDefinition | undefined {
        if (!query) return undefined;
        const norm = this.normalizeKey(query);
        return this.aliasMap.get(norm) || this.commandMap.get(norm);
    }

    /**
     * Finds the tutorial suite mapped to a given command or command alias.
     */
    public getTutorialForCommand(commandNameOrAlias: string): TutorialDefinition | undefined {
        if (!commandNameOrAlias) return undefined;
        const norm = this.normalizeKey(commandNameOrAlias);
        return this.commandMap.get(norm) || this.aliasMap.get(norm);
    }

    /**
     * Returns the formatted list of related commands for card display according to language.
     */
    public getRelatedCommandsList(tutorial: TutorialDefinition, lang: string = 'id', prefix: string = '.'): string {
        const isEnglish = lang.toLowerCase().startsWith('en');
        const list = isEnglish
            ? tutorial.localizedRelatedCommands?.en || tutorial.relatedCommands
            : tutorial.localizedRelatedCommands?.id || tutorial.relatedCommands;

        // Dedup and prefix
        const seen = new Set<string>();
        const formatted: string[] = [];
        for (const item of list) {
            const clean = item.replace(/^[.-]+/, '').trim();
            if (clean && !seen.has(clean)) {
                seen.add(clean);
                formatted.push(`\`${prefix}${clean}\``);
            }
        }
        return formatted.join(', ');
    }
}

const tutorialService = new TutorialService();
export default tutorialService;
