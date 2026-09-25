import fs from 'fs';
import path from 'path';

export interface SystemConfig {
    autoWhitelistOnJoin: boolean;
    autoArchiveOnJoin: boolean;
    updatedAt: string;
}

let cachedConfig: SystemConfig | null = null;

function getStorageRoot(): string {
    if (process.env.STORAGE_DIR && fs.existsSync(process.env.STORAGE_DIR)) {
        return process.env.STORAGE_DIR;
    }
    if (fs.existsSync('/app/storage')) {
        return '/app/storage';
    }
    return path.resolve(process.cwd(), 'storage');
}

export function getConfigFilePath(): string {
    const storageDir = getStorageRoot();
    if (!fs.existsSync(storageDir)) {
        try {
            fs.mkdirSync(storageDir, { recursive: true });
        } catch {
            // Ignore error if directory already exists
        }
    }
    return path.join(storageDir, 'system_config.json');
}

export function getDefaultSystemConfig(): SystemConfig {
    return {
        autoWhitelistOnJoin: process.env.AUTO_WHITELIST_GROUPS === 'true',
        autoArchiveOnJoin: process.env.AUTO_ARCHIVE_GROUPS === 'true',
        updatedAt: new Date().toISOString()
    };
}

export function getSystemConfig(): SystemConfig {
    if (cachedConfig) {
        return cachedConfig;
    }

    const filePath = getConfigFilePath();
    if (fs.existsSync(filePath)) {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            cachedConfig = {
                autoWhitelistOnJoin:
                    typeof parsed.autoWhitelistOnJoin === 'boolean'
                        ? parsed.autoWhitelistOnJoin
                        : process.env.AUTO_WHITELIST_GROUPS === 'true',
                autoArchiveOnJoin:
                    typeof parsed.autoArchiveOnJoin === 'boolean'
                        ? parsed.autoArchiveOnJoin
                        : process.env.AUTO_ARCHIVE_GROUPS === 'true',
                updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
            };
            return cachedConfig;
        } catch (err) {
            console.warn('[SystemConfig] Failed to parse system_config.json, using defaults:', err);
        }
    }

    cachedConfig = getDefaultSystemConfig();
    return cachedConfig;
}

export function isAutoWhitelistEnabled(): boolean {
    return getSystemConfig().autoWhitelistOnJoin;
}

export function setAutoWhitelist(enabled: boolean): SystemConfig {
    const current = getSystemConfig();
    const config: SystemConfig = {
        ...current,
        autoWhitelistOnJoin: Boolean(enabled),
        updatedAt: new Date().toISOString()
    };

    cachedConfig = config;
    const filePath = getConfigFilePath();
    try {
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
        console.error('[SystemConfig] Failed to write system_config.json:', err);
    }

    return config;
}

export function isAutoArchiveEnabled(): boolean {
    return getSystemConfig().autoArchiveOnJoin;
}

export function setAutoArchive(enabled: boolean): SystemConfig {
    const current = getSystemConfig();
    const config: SystemConfig = {
        ...current,
        autoArchiveOnJoin: Boolean(enabled),
        updatedAt: new Date().toISOString()
    };

    cachedConfig = config;
    const filePath = getConfigFilePath();
    try {
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
        console.error('[SystemConfig] Failed to write system_config.json:', err);
    }

    return config;
}

export function clearSystemConfigCache(): void {
    cachedConfig = null;
}
