import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { resolveId, getUser } from '../utils/casino.js';
import { formatRupiah, parseCurrencyAmount } from '../utils/currency.js';

const addBalanceTool: ToolModule = {
    definition: {
        name: 'addbalance',
        description: 'Add balance to a user from the house vault. (Owner only)',
        descriptionKey: 'tools.commands.addbalance.description',
        category: 'Casino',
        owner: true,
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Target user and amount' }
            },
            required: ['input']
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const { msg, sock } = ctx;

        const mentionedJidList = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const targetJid = mentionedJidList.length > 0 ? mentionedJidList[0] : null;

        if (!targetJid) {
            return ctx.t('tools.addbalance.mention_required');
        }

        let cleanedInputStr = String(args.input || '').trim();
        for (const jid of mentionedJidList) {
            const num = jid.split('@')[0];
            cleanedInputStr = cleanedInputStr.replace(new RegExp(`@?${num}`, 'g'), '');
        }

        const amount = parseCurrencyAmount(cleanedInputStr);

        if (amount === null || amount <= 0) {
            return ctx.t('tools.addbalance.invalid_amount');
        }

        try {
            const cleanTargetJid = await resolveId(targetJid, sock, msg.key.remoteJid);
            await prisma.$transaction(async (tx) => {
                // Ensure target user exists and add balance
                const targetUser = await getUser(tx as any, cleanTargetJid);
                await tx.user.update({
                    where: { id: targetUser.id },
                    data: { balance: { increment: amount } }
                });

                // Ensure vault exists and update
                const vault = await tx.houseVault.findUnique({ where: { id: 1 } });
                if (!vault) {
                    await tx.houseVault.create({
                        data: {
                            id: 1,
                            payout: BigInt(amount),
                            netProfit: BigInt(-amount)
                        }
                    });
                } else {
                    await tx.houseVault.update({
                        where: { id: 1 },
                        data: {
                            payout: { increment: BigInt(amount) },
                            netProfit: { decrement: BigInt(amount) }
                        }
                    });
                }
            });

            await new Promise((resolve) => setTimeout(resolve, 1000));
            await sock.sendMessage(
                msg.key.remoteJid!,
                {
                    text: ctx.t('tools.addbalance.success', {
                        amount: formatRupiah(amount),
                        target: targetJid.split('@')[0]
                    }),
                    mentions: [targetJid]
                },
                { quoted: msg }
            );
        } catch (error: any) {
            return ctx.t('tools.addbalance.failed', { error: error.message });
        }
    }
};

export default addBalanceTool;
