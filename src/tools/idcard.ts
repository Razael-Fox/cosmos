import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { getSenderJid } from '#utils/casino.js';
import {
    getIdCardByUser,
    startRegistrationSession,
    isUserRegistering,
    cancelRegistrationSession
} from '#utils/idCard.js';
import { generateIdCardImage, fetchUserProfilePic } from '#utils/imageProcessing.js';
import { getTranslator } from '#utils/i18n.js';

export const definition: ToolDefinition = {
    name: 'idcard',
    title: 'Virtual ID Card',
    category: 'General',
    aliases: ['register-id', 'registerid', 'ktp', 'myid', 'check-id'],
    description: 'View your Virtual ID Card or register a new identity card.',
    descriptionKey: 'tools.commands.idcard.description',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Optional action parameter (e.g. register, view, cancel).'
            }
        }
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const t = ctx?.t || getTranslator('en');
    const senderJid = getSenderJid(ctx.msg, ctx.sock);
    if (!senderJid) {
        return t('core.sender_identity_error');
    }

    const rawText = (ctx.msg.message?.conversation || ctx.msg.message?.extendedTextMessage?.text || '').trim();
    const commandPart = rawText.split(/\s+/)[0]?.toLowerCase() || '';
    const actionArg = (args.action || '').trim().toLowerCase();

    const isRegisterCommand =
        commandPart === '.register-id' ||
        commandPart === '.registerid' ||
        actionArg === 'register' ||
        actionArg === 'daftar';

    const isCancelCommand = actionArg === 'cancel' || actionArg === 'batal';

    if (isCancelCommand) {
        if (isUserRegistering(senderJid, ctx.jid)) {
            cancelRegistrationSession(senderJid);
            return t('utilities.idcard.cancelled');
        }
        return t('utilities.idcard.no_active_session');
    }

    if (isRegisterCommand) {
        const existing = await getIdCardByUser(senderJid);
        if (existing) {
            await ctx.sock.sendMessage(
                ctx.jid,
                {
                    text: t('utilities.idcard.already_registered', { nik: existing.nik })
                },
                { quoted: ctx.msg }
            );

            try {
                const pfp = await fetchUserProfilePic(
                    ctx.sock,
                    (ctx.msg.key.participant || ctx.msg.key.remoteJid) ?? senderJid
                );
                const imageBuffer = await generateIdCardImage(existing, pfp);
                const caption = t('utilities.idcard.card_caption', {
                    nik: existing.nik,
                    fullName: existing.fullName,
                    pob: existing.placeOfBirth,
                    dob: existing.dateOfBirth,
                    gender: existing.gender,
                    address: existing.address,
                    religion: existing.religion,
                    maritalStatus: existing.maritalStatus,
                    occupation: existing.occupation,
                    citizenship: existing.citizenship,
                    validUntil: existing.validUntil
                });

                await ctx.sock.sendMessage(ctx.jid, { image: imageBuffer, caption }, { quoted: ctx.msg });
            } catch (err) {
                console.error('[IdCard] Error fetching existing card image:', err);
            }
            return;
        }

        if (isUserRegistering(senderJid, ctx.jid)) {
            return t('utilities.idcard.active_in_progress');
        }

        const prompt = startRegistrationSession(senderJid, ctx.jid, t);
        await ctx.sock.sendMessage(ctx.jid, { text: prompt }, { quoted: ctx.msg });
        return;
    }

    // Default: View existing ID Card
    const existing = await getIdCardByUser(senderJid);
    if (!existing) {
        return t('utilities.idcard.not_registered');
    }

    try {
        await ctx.sock.sendMessage(ctx.jid, { text: t('utilities.idcard.fetching') }, { quoted: ctx.msg });
        const pfp = await fetchUserProfilePic(
            ctx.sock,
            (ctx.msg.key.participant || ctx.msg.key.remoteJid) ?? senderJid
        );
        const imageBuffer = await generateIdCardImage(existing, pfp);
        const caption = t('utilities.idcard.card_caption', {
            nik: existing.nik,
            fullName: existing.fullName,
            pob: existing.placeOfBirth,
            dob: existing.dateOfBirth,
            gender: existing.gender,
            address: existing.address,
            religion: existing.religion,
            maritalStatus: existing.maritalStatus,
            occupation: existing.occupation,
            citizenship: existing.citizenship,
            validUntil: existing.validUntil
        });

        await ctx.sock.sendMessage(ctx.jid, { image: imageBuffer, caption }, { quoted: ctx.msg });
    } catch (err) {
        console.error('[IdCard] Error viewing ID card:', err);
        return t('utilities.idcard.generation_error');
    }
}

const idCardTool: ToolModule = {
    definition,
    execute
};

export default idCardTool;
