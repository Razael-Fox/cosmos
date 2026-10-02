/**
 * Discord status transport — webhook POST with bounded retry/backoff.
 */
import axios from 'axios';
import { getStatusNotifierConfig } from '../config.js';
import { formatDiscordEmbed } from '../formatters.js';
import type { NotifyEvent, NotifyPayload, NotifySeverity, DeliveryResult } from '../types.js';
import { postJsonWithRetry } from './http.js';

export async function sendDiscord(
    event: NotifyEvent,
    severity: NotifySeverity,
    payload: NotifyPayload
): Promise<DeliveryResult> {
    const config = getStatusNotifierConfig();
    if (!config.discord.enabled || !config.discord.webhookUrl) {
        return { channel: 'discord', success: false, skipped: true, error: 'discord disabled or unconfigured' };
    }

    const body = formatDiscordEmbed(event, severity, payload);
    const result = await postJsonWithRetry(config.discord.webhookUrl, body, { label: 'discord' });
    if (result.success) {
        console.log(`[StatusNotifier] Discord delivered ${event} (severity ${severity}).`);
    } else {
        console.error(`[StatusNotifier] Discord delivery failed for ${event}: ${result.error ?? 'unknown error'}`);
    }
    return {
        channel: 'discord',
        success: result.success,
        error: result.error,
        attempts: result.attempts
    };
}

/**
 * Uploads a file artifact (e.g. the SQLite backup snapshot) to Discord via
 * multipart form-data. Never throws; returns a structured result.
 */
export async function sendDiscordFile(filePath: string, fileName: string, caption: string): Promise<DeliveryResult> {
    const config = getStatusNotifierConfig();
    if (!config.discord.enabled || !config.discord.webhookUrl) {
        return { channel: 'discord', success: false, skipped: true, error: 'discord disabled or unconfigured' };
    }

    try {
        const FormData = (await import('form-data')).default;
        const fs = (await import('fs')).default;
        const form = new FormData();
        form.append('payload_json', JSON.stringify({ content: caption.slice(0, 1900) }));
        form.append('files[0]', fs.createReadStream(filePath), { filename: fileName });

        const response = await axios.post(config.discord.webhookUrl, form, {
            headers: form.getHeaders(),
            timeout: config.requestTimeoutMs,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            validateStatus: () => true
        });

        if (response.status >= 200 && response.status < 300) {
            console.log(`[StatusNotifier] Discord delivered backup artifact (${fileName}).`);
            return { channel: 'discord', success: true, attempts: 1 };
        }
        return { channel: 'discord', success: false, error: `HTTP ${response.status}`, attempts: 1 };
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[StatusNotifier] Discord backup artifact upload failed: ${error}`);
        return { channel: 'discord', success: false, error, attempts: 1 };
    }
}
