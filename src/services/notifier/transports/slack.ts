/**
 * Slack status transport — incoming webhook POST with bounded retry/backoff.
 */
import { getStatusNotifierConfig } from '../config.js';
import { formatSlackBlocks } from '../formatters.js';
import type { NotifyEvent, NotifyPayload, NotifySeverity, DeliveryResult } from '../types.js';
import { postJsonWithRetry } from './http.js';

export async function sendSlack(
    event: NotifyEvent,
    severity: NotifySeverity,
    payload: NotifyPayload
): Promise<DeliveryResult> {
    const config = getStatusNotifierConfig();
    if (!config.slack.enabled || !config.slack.webhookUrl) {
        return { channel: 'slack', success: false, skipped: true, error: 'slack disabled or unconfigured' };
    }

    const body = formatSlackBlocks(event, severity, payload);
    const result = await postJsonWithRetry(config.slack.webhookUrl, body, { label: 'slack' });
    if (result.success) {
        console.log(`[StatusNotifier] Slack delivered ${event} (severity ${severity}).`);
    } else {
        console.error(`[StatusNotifier] Slack delivery failed for ${event}: ${result.error ?? 'unknown error'}`);
    }
    return {
        channel: 'slack',
        success: result.success,
        error: result.error,
        attempts: result.attempts
    };
}
