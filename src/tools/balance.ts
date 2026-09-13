import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid, resolveId, getUser } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { getTranslator } from '../utils/i18n.js';

const balanceTool: ToolModule = {
    definition: {
        name: 'balance',
        aliases: ['bal', 'saldo'],
        description: "Check your current casino coin balance or another user's balance.",
        descriptionKey: 'tools.commands.balance.description',
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

        const mentionedJidList = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const targetJid = mentionedJidList.length > 0 ? mentionedJidList[0] : null;

        let queryJid = senderJid;
        let isCheckingOther = false;

        if (targetJid && targetJid !== senderJid) {
            const ownerNumber = process.env.BOT_PHONE_NUMBER ? process.env.BOT_PHONE_NUMBER.trim() : null;
            const senderRaw = senderJid ? senderJid.split(':')[0].split('@')[0] : null;
            const isOwner = Boolean(msg.key.fromMe) || (ownerNumber !== null && senderRaw === ownerNumber);

            if (!isOwner) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    { text: t('tools.balance.owner_only_other') },
                    { quoted: msg }
                );
                return;
            }
            queryJid = await resolveId(targetJid, sock, msg.key.remoteJid);
            isCheckingOther = true;
        }

        const pushName = !isCheckingOther ? msg.pushName || undefined : undefined;
        const user = await getUser(prisma, queryJid, pushName);

        await new Promise((resolve) => setTimeout(resolve, 3000));

        let displayId = queryJid.split('@')[0];
        let mentionArray: string[] = [];

        if (isCheckingOther && targetJid) {
            displayId = targetJid.split('@')[0];
            mentionArray = [targetJid];
        }

        let text = `${t('tools.balance.title')}\n\n${t('tools.balance.amount', { amount: formatRupiah(user.balance) })}.\n${t('tools.balance.keep_playing')}`;
        if (isCheckingOther) {
            text = `${t('tools.balance.title')}\n\n${t('tools.balance.other_user', { user: displayId, amount: formatRupiah(user.balance) })}`;
        }

        await sock.sendMessage(
            msg.key.remoteJid!,
            {
                text,
                mentions: mentionArray
            },
            { quoted: msg }
        );
    }
};

export default balanceTool;
