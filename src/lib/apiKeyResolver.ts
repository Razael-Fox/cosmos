import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';
import { loadConfig } from '#services/subBotConfigService.js';
import { dbContext } from '#db.js';

dotenv.config();

export type SupportedApiService = 'groq' | 'openrouter' | 'eodhd';

const groqClientPool = new Map<string, Groq>();

export function resolveApiKey(service: SupportedApiService, subBotNumber?: string): string | null {
    let resolvedNumber = subBotNumber;

    if (!resolvedNumber) {
        const store = dbContext.getStore();
        if (store?.sessionId && store.sessionId !== 'default') {
            resolvedNumber = store.sessionId.replace(/^sub_/, '');
        }
    }

    if (resolvedNumber) {
        try {
            const config = loadConfig(resolvedNumber);
            const customKey = config.apiKeys[service];
            if (customKey && customKey.trim().length > 0) {
                return customKey.trim();
            }
        } catch {
            // Fall back to env variables
        }
    }

    // Step 2: Parent Bot Env Variable Fallback
    if (service === 'groq') {
        return process.env.GROQ_API_KEY?.trim() || null;
    }
    if (service === 'openrouter') {
        return process.env.OPENROUTER_API_KEY?.trim() || null;
    }
    if (service === 'eodhd') {
        return process.env.EODHD_API_KEY?.trim() || null;
    }

    return null;
}

export function getGroqClient(subBotNumber?: string): Groq {
    const key = resolveApiKey('groq', subBotNumber);
    if (!key) {
        throw new Error('Groq API key is not configured.');
    }

    if (!groqClientPool.has(key)) {
        groqClientPool.set(key, new Groq({ apiKey: key }));
    }
    return groqClientPool.get(key)!;
}

export function maskApiKey(key: string | null | undefined): string {
    if (!key || key.trim().length === 0) return '';
    const trimmed = key.trim();
    if (trimmed.length <= 8) {
        return '••••••••';
    }
    const prefix = trimmed.slice(0, 4);
    const suffix = trimmed.slice(-4);
    return `${prefix}••••••••${suffix}`;
}
