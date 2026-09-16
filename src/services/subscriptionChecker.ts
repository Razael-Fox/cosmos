import { prisma, getPrismaClient } from '#db.js';
import { stopSubBot } from '#services/subBotService.js';
import { TIER_LIMITS } from '#services/quotaService.js';

/**
 * Daily subscription expiry reconciliation (00:00 UTC).
 * - Marks expired paid subscriptions as EXPIRED.
 * - Pauses excess sub-bots above the FREE ceiling (2), oldest first.
 * - Groups are never auto-deleted; users enter OVER_QUOTA until renewal.
 */
export async function reconcileSubscriptions(): Promise<void> {
    getPrismaClient('default');
    const now = new Date();
    const expired = await prisma.subscription.findMany({
        where: { status: 'ACTIVE', expiresAt: { lt: now } }
    });

    for (const sub of expired) {
        if ((sub as { tier: string }).tier === 'FREE') continue;
        console.log(`[Subscriptions] Expiring ${sub.userId} (${(sub as { tier: string }).tier})`);
        await prisma.subscription.update({
            where: { userId: sub.userId },
            data: { status: 'EXPIRED' }
        });

        const activeBots = await prisma.subBotInstance.findMany({
            where: { ownerJid: sub.userId, status: 'ACTIVE' },
            orderBy: { createdAt: 'asc' }
        });
        const freeCeiling = TIER_LIMITS.FREE.maxSubBots;
        if (activeBots.length > freeCeiling) {
            const excess = activeBots.slice(0, activeBots.length - freeCeiling);
            for (const bot of excess) {
                try {
                    await stopSubBot(bot.id);
                    await prisma.subBotInstance.update({
                        where: { id: bot.id },
                        data: { status: 'PAUSED' }
                    });
                    console.log(`[Subscriptions] Paused excess sub-bot +${bot.id} for ${sub.userId}`);
                } catch (err) {
                    console.error(`[Subscriptions] Failed to pause +${bot.id}:`, err);
                }
            }
        }

        // T-0 receipt notice is delivered opportunistically via the default socket.
        try {
            const { activeConnections } = await import('#utils/connectionManager.js');
            const sock = activeConnections.get('default');
            if (sock) {
                await sock.sendMessage(sub.userId, {
                    text:
                        `⚠️ *Cosmos Subscription Expired*\n\n` +
                        `Your paid plan has ended and your account is now on the Free Tier (2 sub-bots / 5 groups).\n` +
                        `Excess sub-bots were paused (never deleted). Renew anytime at https://razael-fox.my.id/pricing`
                });
            }
        } catch (err) {
            console.error('[Subscriptions] Expiry notice failed:', err);
        }
    }

    // T-3 day reminders.
    const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const expiringSoon = await prisma.subscription.findMany({
        where: { status: 'ACTIVE', expiresAt: { gt: now, lt: soon } }
    });
    for (const sub of expiringSoon) {
        console.log(
            `[Subscriptions] Reminder: ${sub.userId} expires on ${(sub.expiresAt as Date | null)?.toISOString()}`
        );
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    reconcileSubscriptions()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}
