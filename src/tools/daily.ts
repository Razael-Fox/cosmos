import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid, getUser } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { getTranslator } from '../utils/i18n.js';
import { renderCard, renderProgressBar } from '../utils/uiFormatter.js';

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
    execute: async (_args: Record<string, any>, ctx: ToolContext) => {
        const t = ctx?.t || getTranslator('en');
        const { msg, sock } = ctx;
        const senderJid = getSenderJid(msg, sock);

        const pushName = msg.pushName || undefined;
        const user = await getUser(prisma, senderJid, pushName);

        const now = new Date();
        const cooldownMs = 24 * 60 * 60 * 1000;

        if (user.lastDailyClaim) {
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

                const text = renderCard({
                    title: t('tools.daily.cooldown_title', 'DAILY REWARD ON COOLDOWN'),
                    icon: '⏳',
                    headerStyle: 'light',
                    fields: [
                        {
                            icon: '⚠️',
                            label: t('tools.ui.issue_label', 'Issue'),
                            value: t('tools.daily.cooldown_status', 'Already claimed today!')
                        },
                        {
                            icon: '⏱️',
                            label: t('tools.ui.cooldown_remaining', 'Time Remaining:'),
                            value: timeString
                        },
                        {
                            icon: '📊',
                            label: t('tools.daily.cooldown_progress', 'Cooldown Progress'),
                            value: `\n   ${renderProgressBar({ current: timePassed, max: cooldownMs })}`
                        }
                    ],
                    tips: [t('tools.daily.tip_work', 'Work a shift with .work while waiting for your daily reset!')]
                });

                await sock.sendMessage(msg.key.remoteJid!, { text }, { quoted: msg });
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

        await new Promise((resolve) => setTimeout(resolve, 1000));

        const text = renderCard({
            title: t('tools.daily.reward_claimed', 'DAILY REWARD CLAIMED'),
            icon: '🎉',
            headerStyle: 'light',
            fields: [
                {
                    icon: '💰',
                    label: t('tools.daily.reward_received', 'Reward Received'),
                    value: `+${formatRupiah(reward)}`
                },
                {
                    icon: '💵',
                    label: t('tools.work.balance_label', 'New Balance'),
                    value: formatRupiah(updatedUser.balance)
                },
                {
                    icon: '⏱️',
                    label: t('tools.daily.next_claim', 'Next Claim'),
                    value: t('tools.daily.twenty_four_hours')
                }
            ],
            tips: [t('tools.daily.tip_multiply', 'Use .slot or .coinflip to multiply your daily earnings!')]
        });

        await sock.sendMessage(msg.key.remoteJid!, { text }, { quoted: msg });
    }
};

export default dailyTool;
