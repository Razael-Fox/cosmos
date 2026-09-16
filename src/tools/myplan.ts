import { ToolDefinition, ToolContext } from './types.js';
import { getSenderJid, formatMentions } from '#utils/casino.js';
import { isOwnerId } from '#utils/owner.js';
import { QuotaService } from '#services/quotaService.js';
import { renderUsageBar } from '#services/subscriptionService.js';
import { formatRupiah } from '#utils/currency.js';

export const definition: ToolDefinition = {
    name: 'myplan',
    title: 'Subscription Plan',
    category: 'System',
    aliases: ['.myplan', '.limits'],
    description: 'View your active Cosmos subscription tier and quota usage.',
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
        quota.tier === 'FREE' ? 'Free Tier' : quota.tier === 'SUBSIDIZED' ? 'Subsidized Tier' : 'Partner Tier';
    const status = quota.isOwner
        ? 'Bot Owner (Unlimited)'
        : `Active${quota.expiresAt ? ` (Valid until ${quota.expiresAt.toDateString()})` : ''}`;
    const bonus = quota.economyMultiplier.toFixed(2);

    const text =
        `📊 *Cosmos Subscription & Limits*\n\n` +
        `User: @${senderJid.split('@')[0]}\n` +
        `Plan: ${planLabel}\n` +
        `Status: ${status}\n\n` +
        `• Whitelisted Groups: ${renderUsageBar(quota.groups.current, quota.groups.max)} ${quota.groups.current} / ${Number.isFinite(quota.groups.max) ? quota.groups.max : '∞'} used\n` +
        `• Active Sub-Bots: ${renderUsageBar(quota.subBots.current, quota.subBots.max)} ${quota.subBots.current} / ${Number.isFinite(quota.subBots.max) ? quota.subBots.max : '∞'} used\n` +
        `• Custom Prefix: ${quota.customPrefixAllowed ? 'Enabled' : 'Locked (.)'}\n` +
        `• Economy Bonus: ${bonus}x Multiplier\n\n` +
        `Need more resources? Upgrade anytime at https://razael-fox.my.id/pricing\n` +
        `_Example upgrade cost: Subsidized ${formatRupiah(10000)}/month._`;

    await ctx.sock.sendMessage(ctx.jid, { text, mentions }, { quoted: ctx.msg });
    return;
}
