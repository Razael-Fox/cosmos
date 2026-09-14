import fs from 'fs';
import path from 'path';

export interface SubBotFeatures {
    casino: boolean;
    bank: boolean;
    loan: boolean;
    jobs: boolean;
    shop: boolean;
    property: boolean;
    downloaders: boolean;
    autodl: boolean;
    autosticker: boolean;
    autocorrection: boolean;
    offlineAi: boolean;
    forexAnnouncement: boolean;
    stt: boolean;
}

export interface SubBotApiKeys {
    groq: string | null;
    openrouter: string | null;
    eodhd: string | null;
}

export interface SubBotPermissions {
    allowGroupCommands: boolean;
    allowDmCommands: boolean;
    whitelistedGroups: string[];
}

export interface SubBotCustomResponses {
    welcomeMessage: string | null;
}

export interface SubBotConfig {
    subBotNumber: string;
    ownerJid: string;
    botName: string;
    prefix: string;
    mode: 'public' | 'self';
    language: 'id' | 'en';
    features: SubBotFeatures;
    apiKeys: SubBotApiKeys;
    permissions: SubBotPermissions;
    customResponses: SubBotCustomResponses;
    createdAt: string;
    updatedAt: string;
}

const configCache = new Map<string, SubBotConfig>();

export function getDefaultFeatures(): SubBotFeatures {
    return {
        casino: true,
        bank: true,
        loan: true,
        jobs: true,
        shop: true,
        property: true,
        downloaders: true,
        autodl: true,
        autosticker: true,
        autocorrection: false,
        offlineAi: true,
        forexAnnouncement: true,
        stt: true
    };
}

export function getDefaultConfig(subBotNumber: string, ownerJid?: string): SubBotConfig {
    const now = new Date().toISOString();
    return {
        subBotNumber,
        ownerJid: ownerJid || `${subBotNumber}@s.whatsapp.net`,
        botName: 'Cosmos Sub-Bot',
        prefix: '.',
        mode: 'public',
        language: 'id',
        features: getDefaultFeatures(),
        apiKeys: {
            groq: null,
            openrouter: null,
            eodhd: null
        },
        permissions: {
            allowGroupCommands: true,
            allowDmCommands: true,
            whitelistedGroups: []
        },
        customResponses: {
            welcomeMessage: null
        },
        createdAt: now,
        updatedAt: now
    };
}

export function getConfigFilePath(subBotNumber: string): string {
    const cleanNumber = subBotNumber.replace(/^sub_/, '');
    const botDir = path.resolve(process.cwd(), 'database', cleanNumber);
    if (!fs.existsSync(botDir)) {
        fs.mkdirSync(botDir, { recursive: true });
    }
    return path.join(botDir, 'config.json');
}

export function loadConfig(subBotNumber: string): SubBotConfig {
    const cleanNumber = subBotNumber.replace(/^sub_/, '');
    if (configCache.has(cleanNumber)) {
        return configCache.get(cleanNumber)!;
    }

    const filePath = getConfigFilePath(cleanNumber);
    if (fs.existsSync(filePath)) {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            const defaults = getDefaultConfig(cleanNumber);
            const merged: SubBotConfig = {
                ...defaults,
                ...parsed,
                features: {
                    ...defaults.features,
                    ...(parsed.features || {})
                },
                apiKeys: {
                    ...defaults.apiKeys,
                    ...(parsed.apiKeys || {})
                },
                permissions: {
                    ...defaults.permissions,
                    ...(parsed.permissions || {})
                },
                customResponses: {
                    ...defaults.customResponses,
                    ...(parsed.customResponses || {})
                }
            };
            configCache.set(cleanNumber, merged);
            return merged;
        } catch (err) {
            console.error(`[SubBotConfig] Error reading config for ${cleanNumber}:`, err);
        }
    }

    const def = getDefaultConfig(cleanNumber);
    saveConfig(cleanNumber, def);
    return def;
}

export function saveConfig(subBotNumber: string, config: SubBotConfig): void {
    const cleanNumber = subBotNumber.replace(/^sub_/, '');
    config.updatedAt = new Date().toISOString();
    configCache.set(cleanNumber, config);

    const filePath = getConfigFilePath(cleanNumber);
    try {
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
        console.error(`[SubBotConfig] Failed to save config for ${cleanNumber}:`, err);
    }
}

export function isFeatureEnabled(subBotNumber: string, featureKey: string): boolean {
    const config = loadConfig(subBotNumber);
    const key = featureKey as keyof SubBotFeatures;
    if (key in config.features) {
        return config.features[key];
    }
    return true;
}

export function updateFeature(subBotNumber: string, featureKey: string, enabled: boolean): SubBotConfig {
    const config = loadConfig(subBotNumber);
    const key = featureKey as keyof SubBotFeatures;
    if (key in config.features) {
        config.features[key] = enabled;
        saveConfig(subBotNumber, config);
    }
    return config;
}

export function setApiKey(
    subBotNumber: string,
    service: 'groq' | 'openrouter' | 'eodhd',
    key: string | null
): SubBotConfig {
    const config = loadConfig(subBotNumber);
    config.apiKeys[service] = key ? key.trim() : null;
    saveConfig(subBotNumber, config);
    return config;
}

export function setMode(subBotNumber: string, mode: 'public' | 'self'): SubBotConfig {
    const config = loadConfig(subBotNumber);
    config.mode = mode;
    saveConfig(subBotNumber, config);
    return config;
}

export function setPrefix(subBotNumber: string, prefix: string): SubBotConfig {
    const config = loadConfig(subBotNumber);
    config.prefix = prefix.trim() || '.';
    saveConfig(subBotNumber, config);
    return config;
}

export function setName(subBotNumber: string, name: string): SubBotConfig {
    const config = loadConfig(subBotNumber);
    config.botName = name.trim() || 'Cosmos Sub-Bot';
    saveConfig(subBotNumber, config);
    return config;
}

export function setLanguage(subBotNumber: string, lang: 'id' | 'en'): SubBotConfig {
    const config = loadConfig(subBotNumber);
    config.language = lang;
    saveConfig(subBotNumber, config);
    return config;
}

export function resetConfig(subBotNumber: string): SubBotConfig {
    const cleanNumber = subBotNumber.replace(/^sub_/, '');
    const current = loadConfig(cleanNumber);
    const defaults = getDefaultConfig(cleanNumber, current.ownerJid);
    saveConfig(cleanNumber, defaults);
    return defaults;
}

export function clearConfigCache(subBotNumber?: string): void {
    if (subBotNumber) {
        configCache.delete(subBotNumber.replace(/^sub_/, ''));
    } else {
        configCache.clear();
    }
}
