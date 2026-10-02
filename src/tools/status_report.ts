import { ToolDefinition, ToolContext } from './types.js';
import { getTranslator } from '#utils/i18n.js';
import { formatRupiah } from '#utils/currency.js';
import { collectAuditDigest, collectHealth } from '#services/statusNotifier/index.js';

export const definition: ToolDefinition = {
    name: 'status report',
    title: 'Status Report',
    displayNames: {
        en: 'status report',
        id: 'status laporan'
    },
    category: 'System & Help',
    aliases: ['status report', 'status audit', 'status health', 'status_report'],
    description: 'Owner-only: display an on-demand health snapshot and audit digest.',
    descriptionKey: 'tools.commands.status_report.description',
    owner: true,
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const t = ctx?.t || getTranslator('en');

    const [health, digest] = await Promise.all([collectHealth(), collectAuditDigest(24)]);

    const healthLine = health.healthy
        ? t('tools.status_report.health_ok')
        : t('tools.status_report.health_degraded', { reasons: health.degradedReasons.join('; ') });

    return (
        `${t('tools.status_report.header')}\n\n` +
        `${t('tools.status_report.health_title')}\n` +
        `• ${healthLine}\n` +
        `• ${t('tools.status_report.database_label')}: ${
            health.dbExists
                ? t('tools.status_report.db_present', { integrity: health.integrity })
                : t('tools.status_report.db_absent')
        }\n` +
        `• ${t('tools.status_report.prisma_label')}: ${
            health.prismaOk ? t('tools.status_report.state_ok') : t('tools.status_report.state_failed')
        }\n` +
        `• ${t('tools.status_report.bot_label')}: ${
            health.botDown ? t('tools.status_report.state_offline') : t('tools.status_report.state_online')
        }\n\n` +
        `${t('tools.status_report.audit_title', { hours: digest.windowHours })}\n` +
        `• ${t('tools.status_report.activities_label')}: ${digest.activityCount} (${formatRupiah(digest.activityVolume)})\n` +
        `• ${t('tools.status_report.bank_label')}: ${digest.bankTransactionCount} (${formatRupiah(digest.bankVolume)})\n` +
        `• ${t('tools.status_report.loans_label')}: ${digest.loanCreatedCount} (${formatRupiah(digest.loanVolume)})\n` +
        `• ${t('tools.status_report.loans_defaulted_label')}: ${digest.loanDefaultedCount}\n` +
        `• ${t('tools.status_report.ip_access_label')}: ${digest.ipAccessCount} (${digest.failedIpAccessCount} failed)\n` +
        `• ${t('tools.status_report.payments_label')}: ${digest.paymentCount} (${formatRupiah(digest.paymentVolume)})`
    );
}
