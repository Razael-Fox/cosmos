import { ToolDefinition, ToolContext } from './types.js';
import { getSenderJid } from '#utils/casino.js';
import { isOwnerId } from '#utils/owner.js';
import { executeWithUserLock } from '#services/quotaService.js';
import { activateSubscription, canonicalJidForPhone, normalizeTier } from '#services/subscriptionService.js';
import { sendIpcCommand } from '#services/ipcServer.js';

export const definition: ToolDefinition = {
    name: 'sub',
    title: 'Subscription Admin',
    category: 'System',
    aliases: ['.sub'],
    description: 'Manage Cosmos subscriptions. Admin: .sub add <phone> <tier> <days>.',
    descriptionKey: 'tools.commands.sub.description',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Subscription command (e.g. add 628123456789 subsidized 30)' }
        },
        required: []
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const raw = String(args.query || '').trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    const action = (parts[0] || '').toLowerCase();
    const senderJid = getSenderJid(ctx.msg);

    if (action !== 'add') {
        return ctx.t('tools.sub.usage');
    }

    if (!isOwnerId(senderJid)) {
        return ctx.t('core.owner_only');
    }

    const phone = (parts[1] || '').replace(/\D/g, '');
    const tier = normalizeTier(parts[2] || '');
    const days = Number.parseInt(parts[3] || '30', 10);
    if (!phone || phone.length < 8 || !tier || !Number.isFinite(days) || days <= 0 || days > 365) {
        return ctx.t('tools.sub.usage');
    }

    const userJid = canonicalJidForPhone(phone);
    try {
        const { expiresAt, orderRef } = await executeWithUserLock(userJid, () =>
            activateSubscription(
                userJid,
                tier,
                days,
                senderJid,
                `Manual activation via .sub add (${orderRefFallback()})`
            )
        );
        void orderRef;
        await sendIpcCommand('/internal/subscriptions/activated', {
            userJid,
            tier,
            expiresAt: expiresAt ? expiresAt.toISOString() : 'Unlimited'
        }).catch((err) => console.error('[Sub] IPC activation receipt failed:', err));

        return ctx.t('tools.sub.activated', {
            tier,
            days: String(days),
            user: phone,
            validUntil: expiresAt ? expiresAt.toDateString() : 'Unlimited'
        });
    } catch (err) {
        console.error('[Sub] Activation failed:', err);
        return ctx.t('tools.sub.failed');
    }
}

function orderRefFallback(): string {
    return `COSMOS-SUB-${Math.floor(Date.now() / 1000)}`;
}
