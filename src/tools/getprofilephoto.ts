import { ToolDefinition, ToolContext } from './types.js';
import { jidNormalizedUser } from '@whiskeysockets/baileys';

export const definition: ToolDefinition = {
    name: 'getprofilephoto',
    title: 'Get Profile Photo',
    category: 'Tools & Utilities',
    aliases: ['getpp', 'pp'],
    description:
        'Fetches the profile photo of a user. The photo will be auto-deleted after 10 seconds. You can mention the user, quote their message, or just use the command to get your own profile photo.',
    descriptionKey: 'tools.commands.getprofilephoto.description',
    owner: false,
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const { sock, msg, jid } = ctx;

    let targetJid: string | null;

    // Check if the command replied to a message
    const quotedMsgInfo = msg.message?.extendedTextMessage?.contextInfo;
    if (quotedMsgInfo?.participant) {
        targetJid = quotedMsgInfo.participant;
    }
    // Check if there are mentions
    else if (quotedMsgInfo?.mentionedJid && quotedMsgInfo.mentionedJid.length > 0) {
        targetJid = quotedMsgInfo.mentionedJid[0];
    }
    // If no mentions or quotes, get the sender's own profile photo
    else {
        const senderRaw = msg.key.fromMe
            ? sock.user?.id || (sock.user as any)?.lid
            : msg.key.participant || msg.key.remoteJid;
        targetJid = senderRaw ? jidNormalizedUser(senderRaw) : null;
    }

    if (!targetJid) {
        return ctx.t('tools.profile_photo.target_not_found');
    }

    targetJid = jidNormalizedUser(targetJid);

    // Sanitize msg.key for self-messages in groups to prevent reaction failures
    const getSafeKey = (k: any) => {
        if (!k.fromMe) return k;
        const safeKey = { ...k };
        delete safeKey.participant;
        return safeKey;
    };
    const safeMsgKey = getSafeKey(msg.key);

    let tempFilePath: string | null = null;

    try {
        await sock.sendMessage(jid, { react: { text: '⏳', key: safeMsgKey } });

        // Fetch the profile picture URL. Using 'image' to get the high quality one.
        const ppUrl = await sock.profilePictureUrl(targetJid, 'image');

        if (!ppUrl) {
            await sock.sendMessage(jid, { react: { text: '❌', key: safeMsgKey } });
            await sock.sendMessage(jid, {
                text: ctx.t('tools.profile_photo.fetch_failed')
            });
            return;
        }

        // Notify user that we are downloading
        await sock.sendMessage(jid, { text: ctx.t('tools.profile_photo.processing') });

        // Download the image manually to ensure it's valid and to avoid silent drop
        const response = await fetch(ppUrl);
        if (!response.ok) {
            throw new Error(`Failed to download profile photo: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        console.log(`[Get Profile Photo] ppUrl: ${ppUrl}`);
        console.log(`[Get Profile Photo] Downloaded buffer size: ${buffer.length} bytes`);

        // Save buffer to temporary file
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        tempFilePath = path.join(os.tmpdir(), `pp_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`);
        fs.writeFileSync(tempFilePath, buffer);

        // Send image and auto-delete after 10 seconds.
        // We do this for ALL requests because WhatsApp has officially blocked sending "View Once" messages from Web/Linked Devices.
        const sentMsg = await sock.sendMessage(jid, {
            image: { url: tempFilePath },
            caption: ctx.t('tools.profile_photo.caption')
        });

        await sock.sendMessage(jid, { react: { text: '✅', key: safeMsgKey } });

        if (sentMsg?.key) {
            setTimeout(async () => {
                await sock.sendMessage(jid, { delete: sentMsg.key }).catch(() => {});
            }, 10000);
        }

        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        console.log('Profile photo fetched successfully', { jid, targetJid });
        return;
    } catch (err: any) {
        console.error('[Get Profile Photo Error]', err);
        console.error('Failed to fetch profile photo', { error: err.message, targetJid });
        await sock.sendMessage(jid, { react: { text: '❌', key: safeMsgKey } });

        if (tempFilePath) {
            const fs = await import('fs');
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        }

        // Handle specific Baileys error where no profile picture is available (usually returns 401 or 404)
        if (err.message && (err.message.includes('not-authorized') || err.message.includes('Item not found'))) {
            return ctx.t('tools.profile_photo.hidden_or_none');
        }

        return ctx.t('tools.profile_photo.error');
    }
}
