import { ToolDefinition, ToolContext } from './types.js';
import { getSenderJid, cleanId } from '#utils/casino.js';
import {
    loadConfig,
    updateFeature,
    setApiKey,
    setMode,
    setPrefix,
    setName,
    setLanguage,
    resetConfig,
    SubBotFeatures
} from '#services/subBotConfigService.js';
import { maskApiKey } from '#utils/apiKeyResolver.js';
import { getPrimaryOwnerNumber } from '#utils/owner.js';
import { dbContext } from '#db.js';
import { renderCard } from '#utils/uiFormatter.js';
import dotenv from 'dotenv';

dotenv.config();

export const definition: ToolDefinition = {
    name: 'config',
    title: 'Sub-Bot Configuration',
    category: 'System',
    aliases: ['.config'],
    description: 'View and customize your sub-bot internal feature configuration and API keys.',
    descriptionKey: 'tools.commands.config.description',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description:
                    'Configuration command (e.g. enable <feature>, disable <feature>, api <service> <key>, mode <public|self>, prefix <char>, name <text>, lang <id|en>, reset)'
            }
        },
        required: []
    }
};

const FEATURE_ALIASES: Record<string, keyof SubBotFeatures> = {
    casino: 'casino',
    game: 'casino',
    games: 'casino',
    bank: 'bank',
    atm: 'bank',
    loan: 'loan',
    loans: 'loan',
    job: 'jobs',
    jobs: 'jobs',
    work: 'jobs',
    shop: 'shop',
    store: 'shop',
    property: 'property',
    realestate: 'property',
    downloader: 'downloaders',
    downloaders: 'downloaders',
    media: 'downloaders',
    autodl: 'autodl',
    autosticker: 'autosticker',
    sticker: 'autosticker',
    autocorrection: 'autocorrection',
    autocorrect: 'autocorrection',
    offlineai: 'offlineAi',
    ai: 'offlineAi',
    forex: 'forexAnnouncement',
    forexannouncement: 'forexAnnouncement',
    inflation: 'forexAnnouncement',
    stt: 'stt',
    voice: 'stt'
};

const VALID_FEATURES_LIST = [
    'casino',
    'bank',
    'loan',
    'jobs',
    'shop',
    'property',
    'downloaders',
    'autodl',
    'autosticker',
    'autocorrection',
    'offlineAi',
    'forex',
    'stt'
].join(', ');

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const rawQuery = (args.query || '').trim();
    const parts = rawQuery.split(/\s+/).filter(Boolean);
    const action = parts[0]?.toLowerCase() || '';

    const senderJid = getSenderJid(ctx.msg);
    const senderClean = cleanId(senderJid);
    const store = dbContext.getStore();
    const currentSessionId = store?.sessionId || 'default';
    const primaryAdmin = getPrimaryOwnerNumber() ? cleanId(getPrimaryOwnerNumber()) : '';

    // Target sub-bot number resolution
    const targetNumber = currentSessionId !== 'default' ? currentSessionId.replace(/^sub_/, '') : senderClean;

    const config = loadConfig(targetNumber);
    const isOwner = senderClean === cleanId(config.ownerJid) || (primaryAdmin && senderClean === primaryAdmin);

    if (!isOwner) {
        return ctx.t('tools.config.not_owner');
    }

    if (action === 'enable' || action === 'disable') {
        const featureInput = parts[1]?.toLowerCase();
        if (!featureInput) {
            return ctx.t('tools.config.feature_not_found', { feature: 'none', list: VALID_FEATURES_LIST });
        }

        const resolvedKey = FEATURE_ALIASES[featureInput];
        if (!resolvedKey) {
            return ctx.t('tools.config.feature_not_found', { feature: featureInput, list: VALID_FEATURES_LIST });
        }

        const enable = action === 'enable';
        updateFeature(targetNumber, resolvedKey, enable);

        const statusStr = enable ? ctx.t('tools.config.status_enabled') : ctx.t('tools.config.status_disabled');
        return ctx.t('tools.config.feature_toggled', { feature: resolvedKey, status: statusStr });
    }

    if (action === 'api') {
        const service = parts[1]?.toLowerCase() as 'groq' | 'openrouter' | 'eodhd';
        if (!['groq', 'openrouter', 'eodhd'].includes(service)) {
            return ctx.t('tools.config.api_invalid_service');
        }

        const key = parts[2];
        if (!key) {
            return ctx.t('tools.config.api_usage', { service });
        }

        let reply: string;
        if (key.toLowerCase() === 'clear' || key.toLowerCase() === 'remove') {
            setApiKey(targetNumber, service, null);
            reply = ctx.t('tools.config.api_key_cleared', { service });
        } else {
            setApiKey(targetNumber, service, key);
            const masked = maskApiKey(key);
            reply = ctx.t('tools.config.api_key_updated', { service, masked });
        }

        if (ctx.jid.endsWith('@g.us')) {
            reply += `\n\n${ctx.t('tools.config.api_key_security_warning')}`;
        }
        return reply;
    }

    if (action === 'mode') {
        const mode = parts[1]?.toLowerCase();
        if (mode !== 'public' && mode !== 'self') {
            return ctx.t('tools.config.mode_invalid');
        }
        setMode(targetNumber, mode);
        return ctx.t('tools.config.mode_updated', { mode: mode.toUpperCase() });
    }

    if (action === 'prefix') {
        const prefix = parts[1];
        if (!prefix || prefix.length > 3) {
            return ctx.t('tools.config.prefix_invalid');
        }
        setPrefix(targetNumber, prefix);
        return ctx.t('tools.config.prefix_updated', { prefix });
    }

    if (action === 'name') {
        const name = parts.slice(1).join(' ').trim();
        if (!name) {
            return ctx.t('tools.config.name_required');
        }
        setName(targetNumber, name);
        return ctx.t('tools.config.name_updated', { name });
    }

    if (action === 'lang' || action === 'language') {
        const lang = parts[1]?.toLowerCase() as 'id' | 'en';
        if (lang !== 'id' && lang !== 'en') {
            return ctx.t('tools.config.lang_invalid');
        }
        setLanguage(targetNumber, lang);
        return ctx.t('tools.config.lang_updated', { lang: lang.toUpperCase() });
    }

    if (action === 'reset') {
        resetConfig(targetNumber);
        return ctx.t('tools.config.reset_success');
    }

    // Default: Display visual CGDS configuration card
    const c = loadConfig(targetNumber);
    const f = c.features;
    const badge = (val: boolean) => (val ? ctx.t('tools.config.badge_enabled') : ctx.t('tools.config.badge_disabled'));
    const apiBadge = (k: string | null) =>
        k ? ctx.t('tools.config.badge_custom_key', { key: maskApiKey(k) }) : ctx.t('tools.config.badge_parent_default');

    const card = renderCard({
        title: ctx.t('tools.config.dashboard_title'),
        icon: '⚙️',
        headerStyle: 'heavy',
        t: ctx.t,
        fields: [
            { label: ctx.t('tools.config.device_label'), value: `+${targetNumber}`, boldLabel: true },
            { label: ctx.t('tools.config.name_label'), value: c.botName, boldLabel: true },
            {
                label: `${ctx.t('tools.config.prefix_label')}: [ ${c.prefix} ]  |  ${ctx.t('tools.config.mode_label')}: [ ${c.mode.toUpperCase()} ]  |  ${ctx.t('tools.config.lang_label')}: [ ${c.language.toUpperCase()} ]`,
                value: ''
            }
        ],
        sections: [
            {
                title: ctx.t('tools.config.internal_features'),
                items: [
                    { label: ctx.t('tools.config.feature_casino'), value: badge(f.casino) },
                    { label: ctx.t('tools.config.feature_bank'), value: badge(f.bank) },
                    { label: ctx.t('tools.config.feature_loan'), value: badge(f.loan) },
                    { label: ctx.t('tools.config.feature_jobs'), value: badge(f.jobs) },
                    { label: ctx.t('tools.config.feature_shop'), value: badge(f.shop && f.property) },
                    { label: ctx.t('tools.config.feature_downloaders'), value: badge(f.downloaders) },
                    { label: ctx.t('tools.config.feature_autodl'), value: badge(f.autodl) },
                    { label: ctx.t('tools.config.feature_autosticker'), value: badge(f.autosticker) },
                    { label: ctx.t('tools.config.feature_autocorrection'), value: badge(f.autocorrection) },
                    { label: ctx.t('tools.config.feature_offline_ai'), value: badge(f.offlineAi) },
                    { label: ctx.t('tools.config.feature_forex'), value: badge(f.forexAnnouncement) },
                    { label: ctx.t('tools.config.feature_stt'), value: badge(f.stt) }
                ]
            },
            {
                title: ctx.t('tools.config.api_integrations'),
                items: [
                    { label: ctx.t('tools.config.provider_groq'), value: apiBadge(c.apiKeys.groq) },
                    { label: ctx.t('tools.config.provider_openrouter'), value: apiBadge(c.apiKeys.openrouter) },
                    { label: ctx.t('tools.config.provider_eodhd'), value: apiBadge(c.apiKeys.eodhd) }
                ]
            }
        ],
        tips: [ctx.t('tools.config.tip_toggle'), ctx.t('tools.config.tip_api'), ctx.t('tools.config.tip_mode')]
    });

    return card;
}
