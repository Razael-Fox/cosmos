import { ToolDefinition, ToolContext } from './types.js';
import { getSenderJid, formatMentions } from '#utils/casino.js';
import { isOwnerId } from '#utils/owner.js';
import { QuotaService } from '#services/quotaService.js';
import { renderUsageBar } from '#services/subscriptionService.js';
import { formatRupiah } from '#utils/currency.js';

export const definition: ToolDefinition = {
    name: 'quota',
    title: 'Resource Quota',
    displayNames: { en: 'my quota', id: 'kuota saya' },
    category: 'System',
    aliases: [
        '.my quota',
        'my quota',
        '.check quota',
        'check quota',
        'checkquota',
        '.quota',
        'quota',
        '.myquota',
        'myquota',
        'my-quota',
        'check-quota',
        '.limits',
        'limits'
    ],
    description: 'View your Cosmos resource quotas, active groups, and sub-bot instances.',
    descriptionKey: 'tools.commands.quota.description',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Optional sub-command (unused)' }
        },
        required: []
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    void args;
    const senderJid = getSenderJid(ctx.msg);
    const quota = await QuotaService.getUserQuota(senderJid, isOwnerId(senderJid));
    const mentions = formatMentions([senderJid]);

    const planLabel =
        quota.tier === 'FREE'
            ? ctx.t('tools.myplan.tier_free')
            : quota.tier === 'SUBSIDIZED'
              ? ctx.t('tools.myplan.tier_subsidized')
              : ctx.t('tools.myplan.tier_partner');

    const status = quota.isOwner
        ? ctx.t('tools.myplan.status_owner')
        : `${ctx.t('tools.myplan.status_active')}${
              quota.expiresAt ? ctx.t('tools.myplan.valid_until', { date: quota.expiresAt.toDateString() }) : ''
          }`;

    const unlim = ctx.t('tools.myplan.unlimited', '∞');
    const usedSuffix = ctx.t('tools.myplan.used_suffix', 'used');

    const groupMaxStr = Number.isFinite(quota.groups.max) ? String(quota.groups.max) : unlim;
    const groupAvailStr = Number.isFinite(quota.groups.available) ? String(quota.groups.available) : unlim;
    const subbotMaxStr = Number.isFinite(quota.subBots.max) ? String(quota.subBots.max) : unlim;
    const subbotAvailStr = Number.isFinite(quota.subBots.available) ? String(quota.subBots.available) : unlim;

    const text =
        `${ctx.t('tools.quota.title', '📊 *Cosmos Resource Quota Usage*')}\n\n` +
        `${ctx.t('tools.myplan.user_label', 'User')}: @${senderJid.split('@')[0]}\n` +
        `${ctx.t('tools.myplan.plan_label', 'Plan')}: ${planLabel}\n` +
        `${ctx.t('tools.myplan.status_label', 'Status')}: ${status}\n\n` +
        `• ${ctx.t('tools.myplan.groups_label', 'Whitelisted Groups')}:\n` +
        `  ${renderUsageBar(quota.groups.current, quota.groups.max)} ${quota.groups.current} / ${groupMaxStr} ${usedSuffix} (${ctx.t('tools.quota.available_label', 'Available')}: ${groupAvailStr})\n\n` +
        `• ${ctx.t('tools.myplan.subbots_label', 'Active Sub-Bots')}:\n` +
        `  ${renderUsageBar(quota.subBots.current, quota.subBots.max)} ${quota.subBots.current} / ${subbotMaxStr} ${usedSuffix} (${ctx.t('tools.quota.available_label', 'Available')}: ${subbotAvailStr})\n\n` +
        `💡 ${ctx.t('tools.quota.manage_tip', 'Need more capacity? Upgrade your tier or remove inactive instances.')}\n` +
        `${ctx.t('tools.myplan.example_cost', { cost: formatRupiah(10000) })}\n\n` +
        `💡 ${ctx.t('tools.quota.plan_tip', 'Use .my plan or .check plan to view tier perks and billing details.')}`;

    await ctx.sock.sendMessage(ctx.jid, { text, mentions }, { quoted: ctx.msg });
    return;
}

export default { definition, execute };
