import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { SaraPromptContext } from '../types.js';
import { prisma, dbContext } from '../../../db.js';
import { getSenderJid, cleanId } from '../../../utils/casino.js';
import { isOwnerId } from '../../../utils/owner.js';
import { decryptString } from '../../storageEncryption.js';
import { EphemeralTokenStore } from '../tokenStore.js';
import { loadConfig } from '../../subBotConfigService.js';

export class SaraPromptContextResolver {
    public static async resolveContext(
        sock: WASocket,
        msg: WAMessage,
        chatJid: string,
        locale: string = 'en'
    ): Promise<SaraPromptContext> {
        const callerJid = getSenderJid(msg, sock);
        const callerLid = msg.key.participant?.includes('@lid')
            ? msg.key.participant
            : ((msg as unknown as Record<string, unknown>).participantLid as string | undefined);

        const isFromMe = Boolean(msg.key.fromMe);
        const isOwner = isFromMe || isOwnerId(callerJid) || (Boolean(callerLid) && isOwnerId(callerLid));

        // Resolve sub-bot session details
        const sessionStore = dbContext.getStore();
        const currentSessionId = sessionStore?.sessionId || 'default';
        const isSubBot = currentSessionId !== 'default';
        const subBotNumber = isSubBot ? currentSessionId.replace(/^sub_/, '') : undefined;

        let subBotOwnerName: string | undefined;
        let isSubBotOwnerSession = false;
        let effectiveContactOwnerJid = callerJid;

        if (subBotNumber) {
            try {
                const subBotConfig = loadConfig(subBotNumber);
                if (subBotConfig?.ownerJid) {
                    const ownerRaw = cleanId(subBotConfig.ownerJid);
                    const callerRaw = cleanId(callerJid);
                    if (ownerRaw && callerRaw && ownerRaw === callerRaw) {
                        isSubBotOwnerSession = true;
                    }
                    // Fetch owner display name
                    const ownerUser = await prisma.user.findUnique({
                        where: { id: subBotConfig.ownerJid }
                    });
                    subBotOwnerName = ownerUser?.pushName || ownerUser?.username || 'Owner';

                    // If caller is the sub-bot owner, contacts belong to the owner
                    if (isSubBotOwnerSession) {
                        effectiveContactOwnerJid = subBotConfig.ownerJid;
                    }
                }
            } catch {
                // Sub-bot config not found or invalid
            }
        }

        // Fetch User and ID Card status
        let user = null;
        let hasIdCard = false;
        try {
            user = await prisma.user.findUnique({
                where: { id: callerJid },
                include: { idCard: true }
            });
            hasIdCard = Boolean(user?.idCard);
        } catch {
            // Proceed with null user
        }

        const callerName = msg.pushName || user?.pushName || user?.username || 'User';

        // Chat Context
        const isGroup = chatJid.endsWith('@g.us');
        let groupTitle: string | undefined;
        let isGroupAdmin = false;

        if (isGroup) {
            try {
                const metadata = await sock.groupMetadata(chatJid);
                groupTitle = metadata.subject;
                const participant = metadata.participants.find((p) => cleanId(p.id) === cleanId(callerJid));
                isGroupAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
            } catch {
                groupTitle = 'Group Chat';
            }
        }

        // Quoted Context & Location extraction
        const unwrapped =
            msg.message?.viewOnceMessage?.message ||
            msg.message?.viewOnceMessageV2?.message ||
            msg.message?.viewOnceMessageV2Extension?.message ||
            msg.message;

        const contextInfo =
            unwrapped?.extendedTextMessage?.contextInfo ||
            unwrapped?.imageMessage?.contextInfo ||
            unwrapped?.videoMessage?.contextInfo ||
            unwrapped?.locationMessage?.contextInfo;

        const quotedMsg = contextInfo?.quotedMessage;
        let referencedMessage: SaraPromptContext['referencedMessage'] = null;

        if (quotedMsg) {
            const senderParticipant = contextInfo?.participant || '';
            const quotedLocation = quotedMsg.locationMessage || quotedMsg.liveLocationMessage;
            const locName =
                quotedLocation && 'name' in quotedLocation && typeof quotedLocation.name === 'string'
                    ? quotedLocation.name
                    : undefined;
            const locAddress =
                quotedLocation && 'address' in quotedLocation && typeof quotedLocation.address === 'string'
                    ? quotedLocation.address
                    : undefined;

            const quotedText =
                quotedMsg.conversation ||
                quotedMsg.extendedTextMessage?.text ||
                quotedMsg.imageMessage?.caption ||
                quotedMsg.videoMessage?.caption ||
                (quotedLocation ? `[Location: ${locName || 'Shared Location'}]` : '') ||
                '';
            referencedMessage = {
                senderJid: senderParticipant,
                senderName: senderParticipant ? cleanId(senderParticipant) || 'Participant' : 'Unknown',
                text: quotedText,
                hasMedia: Boolean(quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage),
                mediaType: quotedMsg.imageMessage
                    ? 'image'
                    : quotedMsg.videoMessage
                      ? 'video'
                      : quotedMsg.audioMessage
                        ? 'audio'
                        : undefined,
                location: quotedLocation
                    ? {
                          degreesLatitude: quotedLocation.degreesLatitude ?? 0,
                          degreesLongitude: quotedLocation.degreesLongitude ?? 0,
                          name: locName,
                          address: locAddress
                      }
                    : undefined
            };
        }

        // Zero-Knowledge Pre-Minter:
        // Query UserContactBook for the effective contact owner, decrypt numbers in server RAM,
        // and mint ephemeral 128-bit tokens. Raw phone numbers are NEVER returned in context.
        const knownContactTokens: Array<{ alias: string; token: string }> = [];
        try {
            const savedContacts = await prisma.userContactBook.findMany({
                where: { ownerJid: effectiveContactOwnerJid }
            });

            for (const contact of savedContacts) {
                try {
                    const decryptedJid = decryptString(contact.encryptedJid);
                    const token = EphemeralTokenStore.mintToken(decryptedJid, callerJid);
                    knownContactTokens.push({
                        alias: contact.alias,
                        token
                    });
                } catch (decErr) {
                    console.error(`[SaraPromptContextResolver] Failed to decrypt contact ${contact.alias}:`, decErr);
                }
            }
        } catch (dbErr) {
            console.error('[SaraPromptContextResolver] Failed to load UserContactBook:', dbErr);
        }

        return {
            callerName,
            callerJid,
            callerLid,
            isOwner,
            isGroupAdmin,
            hasIdCard,
            chatType: isGroup ? 'group' : 'dm',
            groupTitle,
            chatJid,
            botName: 'Sara',
            locale,
            subBotNumber,
            subBotOwnerName,
            isSubBotOwnerSession,
            knownContactTokens,
            referencedMessage
        };
    }
}
