import { ToolDefinition, ToolContext } from './types.js';
import { getSenderJid, formatMentions } from '#utils/casino.js';
import { isOwnerId } from '#utils/owner.js';
import { QuotaService } from '#services/quotaService.js';
import { formatRupiah } from '#utils/currency.js';

export const definition: ToolDefinition = {
    name: 'myplan',
    title: 'Subscription Plan',
    displayNames: { en: 'my plan', id: 'paket saya' },
    category: 'System',
    aliases: [
        '.my plan',
        'my plan',
        '.check plan',
        'check plan',
        'checkplan',
        '.plan',
        'plan',
        '.myplan',
        'myplan',
        'my-plan',
        'check-plan'
    ],
    description: 'View your active Cosmos subscription tier, plan perks, and validity.',
    descriptionKey: 'tools.commands.myplan.description',
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

    const bonus = quota.economyMultiplier.toFixed(2);
    const prefixStatus = quota.customPrefixAllowed
        ? ctx.t('tools.myplan.prefix_enabled')
        : ctx.t('tools.myplan.prefix_locked');

    const text =
        `${ctx.t('tools.myplan.title')}\n\n` +
        `${ctx.t('tools.myplan.user_label')}: @${senderJid.split('@')[0]}\n` +
        `${ctx.t('tools.myplan.plan_label')}: ${planLabel}\n` +
        `${ctx.t('tools.myplan.status_label')}: ${status}\n\n` +
        `• ${ctx.t('tools.myplan.custom_prefix_label')}: ${prefixStatus}\n` +
        `• ${ctx.t('tools.myplan.economy_bonus_label')}: ${bonus}${ctx.t('tools.myplan.multiplier_suffix')}\n\n` +
        `${ctx.t('tools.myplan.upgrade_cta')}\n` +
        `${ctx.t('tools.myplan.example_cost', { cost: formatRupiah(10000) })}\n\n` +
        `💡 ${ctx.t('tools.myplan.quota_tip', 'Use .my quota or .check quota to view resource limits and usage.')}`;

    await ctx.sock.sendMessage(ctx.jid, { text, mentions }, { quoted: ctx.msg });
    return;
}
