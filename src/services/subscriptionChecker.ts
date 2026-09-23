import { prisma, getPrismaClient } from '#db.js';
import { stopSubBot } from '#services/subBotService.js';
import { TIER_LIMITS } from '#services/quotaService.js';
import { getChatLanguage, getTranslator } from '#utils/i18n.js';

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
                const lang = await getChatLanguage(sub.userId);
                const t = getTranslator(lang);
                await sock.sendMessage(sub.userId, {
                    text: t('tools.sub.sub_expired_notice')
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
