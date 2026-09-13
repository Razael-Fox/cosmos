import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid, getUser } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { getTranslator } from '../utils/i18n.js';

const dailyTool: ToolModule = {
    definition: {
        name: 'daily',
        aliases: ['klaim', 'claim'],
        description: 'Claim your daily casino coin reward.',
        descriptionKey: 'tools.commands.daily.description',
        category: 'Casino',
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const t = ctx?.t || getTranslator('en');
        const { msg, sock } = ctx;
        const senderJid = getSenderJid(msg, sock);

        const pushName = msg.pushName || undefined;
        const user = await getUser(prisma, senderJid, pushName);

        const now = new Date();

        if (user.lastDailyClaim) {
            const cooldownMs = 24 * 60 * 60 * 1000;
            const timePassed = now.getTime() - user.lastDailyClaim.getTime();

            if (timePassed < cooldownMs) {
                const remainingMs = cooldownMs - timePassed;
                const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
                const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

                let timeString = '';
                if (remainingHours > 0) {
                    timeString +=
                        remainingHours === 1
                            ? t('tools.daily.hours_one')
                            : t('tools.daily.hours_other', { count: remainingHours });
                }
                if (remainingMinutes > 0) {
                    if (timeString) timeString += t('tools.daily.and');
                    timeString +=
                        remainingMinutes === 1
                            ? t('tools.daily.minutes_one')
                            : t('tools.daily.minutes_other', { count: remainingMinutes });
                }
                if (!timeString) {
                    timeString = t('tools.daily.less_than_minute');
                }

                await sock.sendMessage(
                    msg.key.remoteJid!,
                    {
                        text: `⏳ ${t('tools.daily.cooldown', { remaining: timeString })}`
                    },
                    { quoted: msg }
                );
                return;
            }
        }

        const reward = 30000;
        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                balance: { increment: reward },
                lastDailyClaim: now
            }
        });

        await new Promise((resolve) => setTimeout(resolve, 3000));
        await sock.sendMessage(
            msg.key.remoteJid!,
            {
                text: `🎉 ${t('tools.daily.claimed', { amount: formatRupiah(reward) })}\n${t('tools.daily.new_balance', { balance: formatRupiah(updatedUser.balance) })}`
            },
            { quoted: msg }
        );
    }
};

export default dailyTool;
