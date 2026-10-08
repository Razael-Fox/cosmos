import { ToolDefinition, ToolContext } from '../types.js';
import { getTranslator } from '#lib/i18n.js';
import { getChannelHealth, getStatusNotifierConfig, notifyTest } from '#services/notifier/index.js';

export const definition: ToolDefinition = {
    name: 'status notify',
    title: 'Status Channel Health',
    displayNames: {
        en: 'status notify',
        id: 'status notifikasi'
    },
    category: 'System & Help',
    aliases: ['status notify', 'status ping', 'status test', 'notify status'],
    description: 'Owner-only: display external status channel health and send a test notification.',
    descriptionKey: 'tools.commands.status_notify.description',
    owner: true,
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const t = ctx?.t || getTranslator('en');
    const config = getStatusNotifierConfig();
    const health = getChannelHealth();

    const channelLines = health.map((entry) => {
        const state = entry.enabled ? t('tools.status_notify.state_enabled') : t('tools.status_notify.state_disabled');
        const configured = entry.configured
            ? t('tools.status_notify.state_configured')
            : t('tools.status_notify.state_unconfigured');
        return `• ${entry.channel}: ${state} (${configured})`;
    });

    const results = await notifyTest(t('tools.status_notify.test_summary'));

    const deliveryLines = results.map((result) => {
        if (result.skipped) {
            return `• ${result.channel}: ${t('tools.status_notify.delivery_skipped')}`;
        }
        return result.success
            ? `• ${result.channel}: ${t('tools.status_notify.delivery_success')}`
            : `• ${result.channel}: ${t('tools.status_notify.delivery_failed', { error: result.error ?? 'unknown' })}`;
    });

    return (
        `${t('tools.status_notify.header')}\n\n` +
        `${t('tools.status_notify.channels_title')}\n` +
        `${channelLines.join('\n')}\n\n` +
        `${t('tools.status_notify.test_title')}\n` +
        `${deliveryLines.length > 0 ? deliveryLines.join('\n') : t('tools.status_notify.no_channels')}\n\n` +
        `${t('tools.status_notify.footer', {
            enabled: config.enabled ? 'enabled' : 'disabled',
            minSeverity: config.minSeverity
        })}`
    );
}
