/**
 * Discord status transport — webhook POST with bounded retry/backoff.
 */
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
