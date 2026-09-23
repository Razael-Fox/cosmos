import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid, resolveId, getUser, cleanId } from '../utils/casino.js';
import { formatRupiah, parseCurrencyAmount } from '../utils/currency.js';
import { logTransaction } from '../utils/transactionLogger.js';
import { getTranslator } from '../utils/i18n.js';

const transferTool: ToolModule = {
    definition: {
        name: 'transfer',
        aliases: ['tf'],
        description: 'Transfer casino coins to another user.',
        descriptionKey: 'tools.commands.transfer.description',
        category: 'Casino',
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Target user and amount' }
            },
            required: ['input']
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const t = ctx?.t || getTranslator('en');
        const { msg, sock } = ctx;
        const senderJid = getSenderJid(msg, sock);

        const pushName = msg.pushName || undefined;
        const user = await getUser(prisma, senderJid, pushName);

        const mentionedJidList = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const targetJid = mentionedJidList.length > 0 ? mentionedJidList[0] : null;

        if (!targetJid) {
            return t('tools.transfer.mention_required');
        }

        const cleanTargetJid = await resolveId(targetJid, sock, msg.key.remoteJid);

        if (cleanId(cleanTargetJid) === cleanId(senderJid)) {
            return t('tools.transfer.self_transfer');
        }

        let cleanedInputStr = String(args.input || '').trim();
        for (const jid of mentionedJidList) {
            const num = jid.split('@')[0];
            cleanedInputStr = cleanedInputStr.replace(new RegExp(`@?${num}`, 'g'), '');
        }

        const amount = parseCurrencyAmount(cleanedInputStr, Number(user.balance));

        if (amount === null || amount <= 0) {
            return t('tools.transfer.invalid_amount');
        }

        if (Number(user.balance) < amount) {
            return t('tools.transfer.insufficient', { balance: formatRupiah(user.balance) });
        }

        // Anti-Miss: Transaction wrapper
        try {
            await prisma.$transaction(async (tx) => {
                const sender = await tx.user.findUnique({ where: { id: user.id } });
                if (!sender || Number(sender.balance) < amount) {
                    throw new Error(t('tools.transfer.insufficient', { balance: formatRupiah(user.balance) }));
                }

                const targetUser = await getUser(tx as any, cleanTargetJid);
                await tx.user.update({
                    where: { id: targetUser.id },
                    data: { balance: { increment: amount } }
                });

                await tx.user.update({
                    where: { id: user.id },
                    data: { balance: { decrement: amount } }
                });
            });

            // Log the successful transfer
            logTransaction(senderJid, cleanTargetJid, amount);

            await new Promise((resolve) => setTimeout(resolve, 3000));
            await sock.sendMessage(
                msg.key.remoteJid!,
                {
                    text: t('tools.transfer.success', {
                        amount: formatRupiah(amount),
                        target: targetJid.split('@')[0],
                        remaining: formatRupiah(Number(user.balance) - amount)
                    }),
                    mentions: [targetJid]
                },
                { quoted: msg }
            );
        } catch (error: any) {
            return t('tools.transfer.failed', { error: error.message });
        }
    }
};

export default transferTool;
