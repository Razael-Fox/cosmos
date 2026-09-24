import { jidNormalizedUser, WASocket, WAMessage } from '@whiskeysockets/baileys';
import { addGroup, isGroupWhitelisted, prisma, dbContext } from '#db.js';
import toolsHandler from '#tools/handler.js';
import { isAutoStickerEnabled } from '#utils/autoSticker.js';
import { isAutoCorrectionEnabled, analyzeAndCorrectText } from '#utils/autoCorrection.js';
import { isMessageProcessed, markMessageProcessed } from '#utils/messageCache.js';
import { processAutoDl } from '#utils/autodl.js';
import { handleOfflineAiResponder } from '#utils/offlineAi.js';
import { isUserRegistering, processRegistrationStep } from '#utils/idCard.js';
import { processBankTransferConfirmation } from '#tools/bank.js';
import { processLoanConfirmation } from '#tools/loan.js';
import { processJobSelection } from '#tools/job.js';
import { formatMentions } from '#utils/casino.js';
import { getLegacyCanonical } from '#utils/commandFormat.js';
import {
    hasCancellableSession,
    cancelActiveSession,
    unregisterCancellableSessionByUser
} from '#utils/cancellationManager.js';
import { getTranslator } from '#utils/i18n.js';
import { getOwnerNumbers } from '#utils/owner.js';
import { loadConfig, isFeatureEnabled, SubBotFeatures } from '#services/subBotConfigService.js';
import { updateUserPresence, linkPresenceIds } from '#services/presenceService.js';
import {
    hasActiveStickerlySession,
    getStickerlySession,
    deleteStickerlySession,
    deletePreviewMessages,
    removeScheduledDeletions,
    processStickerlySelection
} from '#utils/stickerlySession.js';
import { AgentConfirmationManager } from '#services/agentEngine/confirmationManager.js';
import { AgentLocationStager } from '#services/agentEngine/locationStager.js';

function getRequiredFeatureForTool(toolName: string): keyof SubBotFeatures | null {
    const name = toolName.toLowerCase();
    if (
        [
            'balance',
            'daily',
            'coinflip',
            'dice',
            'slot',
            'vault',
            'fevertime',
            'top',
            'topglobal',
            'addbalance',
            'joingame',
            'shoot'
        ].includes(name)
    ) {
        return 'casino';
    }
    if (['bank', 'transfer'].includes(name)) {
        return 'bank';
    }
    if (['loan'].includes(name)) {
        return 'loan';
    }
    if (['job', 'work', 'apply_license'].includes(name)) {
        return 'jobs';
    }
    if (['shop', 'buy', 'inventory'].includes(name)) {
        return 'shop';
    }
    if (['property', 'realestate', 'catalog', 'sell'].includes(name)) {
        return 'property';
    }
    if (
        [
            'play',
            'playlyrics',
            'stoplyrics',
            'tiktokdl',
            'pinterestdl',
            'telegramdl',
            'ytdl',
            'stickerly',
            'spack',
            'stickerpack'
        ].includes(name)
    ) {
        return 'downloaders';
    }
    if (['autodl'].includes(name)) {
        return 'autodl';
    }
    if (['togglesticker', 'stoptogglesticker', 'sticker_maker'].includes(name)) {
        return 'autosticker';
    }
    if (['toggleautocorrection', 'startautocorrection', 'stopautocorrection'].includes(name)) {
        return 'autocorrection';
    }
    if (['toggleofflineai'].includes(name)) {
        return 'offlineAi';
    }
    if (['stt'].includes(name)) {
        return 'stt';
    }
    return null;
}

function getUnwrappedMessage(m: any): any {
    if (!m) return null;
    if (m.viewOnceMessage?.message) return getUnwrappedMessage(m.viewOnceMessage.message);
    if (m.viewOnceMessageV2?.message) return getUnwrappedMessage(m.viewOnceMessageV2.message);
    if (m.viewOnceMessageV2Extension?.message) return getUnwrappedMessage(m.viewOnceMessageV2Extension.message);
    return m;
}

function hasDirectMedia(rawMsg: any): boolean {
    const m = getUnwrappedMessage(rawMsg);
    if (!m) return false;
    if (m.imageMessage) return true;
    if (m.videoMessage) return true;
    if (m.documentMessage) {
        const mime = m.documentMessage.mimetype || '';
        const filename = m.documentMessage.fileName || '';
        if (
            mime.startsWith('image/') ||
            mime.startsWith('video/') ||
            /\.(jpg|jpeg|png|gif|mp4|mov|webm|mkv|3gp)$/i.test(filename)
        ) {
            return true;
        }
    }
    return false;
}

let activeInteractions = 0;

function markPresenceActive(sock: WASocket, jid: string) {
    activeInteractions++;
    sock.sendPresenceUpdate('available').catch(() => {});
    sock.sendPresenceUpdate('composing', jid).catch(() => {});
}

function markPresenceInactive(sock: WASocket, jid: string, delayMs = 1500) {
    setTimeout(() => {
        try {
            sock.sendPresenceUpdate('paused', jid).catch(() => {});
        } catch {
            /* ignore */
        }
        activeInteractions = Math.max(0, activeInteractions - 1);
    }, delayMs);
}

function markMessageRead(sock: WASocket, msg: WAMessage) {
    if (
        !msg.key.fromMe &&
        msg.key.remoteJid &&
        !msg.key.remoteJid.endsWith('@newsletter') &&
        msg.key.remoteJid !== 'status@broadcast'
    ) {
        try {
            sock.readMessages([msg.key]).catch((err) => {
                console.error('[Message Handler] Failed to mark message as read:', err);
            });
        } catch (err) {
            console.error('[Message Handler] Unexpected error invoking readMessages:', err);
        }
    }
}

export async function handleMessage(sock: WASocket, msg: WAMessage): Promise<void> {
    if (!msg.message || !msg.key.remoteJid || !msg.key.id) return;

    if (isMessageProcessed(msg.key.id)) {
        return;
    }
    markMessageProcessed(msg.key.id);

    console.log('[DEBUG] Message received:', {
        fromMe: msg.key.fromMe,
        remoteJid: msg.key.remoteJid,
        pushName: msg.pushName,
        text: msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    });

    // Only process messages with valid content
    let jid = jidNormalizedUser(msg.key.remoteJid);
    if (jid.endsWith('@lid') && (msg.key as any).remoteJidAlt) {
        jid = jidNormalizedUser((msg.key as any).remoteJidAlt);
    }

    // Extract text
    const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        '';

    // Detect if sender is owner (supports JID, LID, device JID, and OWNER_PHONE_NUMBER)
    const cleanId = (idStr?: string | null) => (idStr ? idStr.split(':')[0].split('@')[0] : null);
    const botRawJid = cleanId(sock.user?.id);
    const botRawLid = cleanId((sock.user as any)?.lid);
    const ownerNumbers = getOwnerNumbers();

    const getJidAndLid = () => {
        if (msg.key.fromMe) {
            const rawBotJid = sock.user?.id ? cleanId(sock.user.id) : null;
            const rawBotLid = (sock.user as any)?.lid ? cleanId((sock.user as any).lid) : null;
            return {
                jidDb: rawBotJid ? `${rawBotJid}@s.whatsapp.net` : null,
                lidDb: rawBotLid
            };
        }
        const p = msg.key.participant || msg.key.remoteJid;
        const pAlt =
            msg.key.participantAlt ||
            msg.key.remoteJidAlt ||
            (msg.key as any).participantAlt ||
            (msg.key as any).remoteJidAlt;
        const out = { jidDb: null as string | null, lidDb: null as string | null };
        if (p && p.endsWith('@lid')) {
            out.lidDb = cleanId(p);
            out.jidDb = pAlt ? `${cleanId(pAlt)}@s.whatsapp.net` : null;
        } else if (p) {
            const clean = cleanId(p);
            out.jidDb = clean ? `${clean}@s.whatsapp.net` : null;
            out.lidDb = pAlt ? cleanId(pAlt) : null;
        }
        return out;
    };

    let { jidDb: senderJidDb } = getJidAndLid();
    const { lidDb: senderLidDb } = getJidAndLid();

    if (senderLidDb && !senderJidDb) {
        // Fallback: check DB if we only have LID but no JID in this message
        try {
            const existing = await prisma.user.findUnique({ where: { lid: senderLidDb } });
            if (existing) senderJidDb = existing.id;
        } catch {
            /* ignore */
        }
    }

    if (!msg.key.fromMe) {
        if (senderJidDb && senderLidDb) {
            linkPresenceIds(senderJidDb, senderLidDb);
        }
        if (senderJidDb) {
            updateUserPresence(senderJidDb, 'online').catch(() => {});
        }
        if (senderLidDb) {
            updateUserPresence(senderLidDb, 'online').catch(() => {});
        }
        const senderCandidate = msg.key.participant || msg.key.remoteJid;
        if (senderCandidate) {
            updateUserPresence(senderCandidate, 'online').catch(() => {});
        }
    }

    if (senderJidDb) {
        const canonicalJid = senderJidDb.includes('@')
            ? senderJidDb
            : `${senderJidDb.replace(/\D/g, '')}@s.whatsapp.net`;
        const cleanDigits = canonicalJid.split('@')[0].replace(/\D/g, '');
        const newWaName = msg.pushName?.trim() || null;

        (async () => {
            try {
                // Merge and delete legacy duplicate record if any exists to avoid UNIQUE constraint conflicts and preserve balance
                if (cleanDigits && cleanDigits !== canonicalJid) {
                    const legacyUser = await prisma.user.findUnique({ where: { id: cleanDigits } }).catch(() => null);
                    if (legacyUser) {
                        const extraBalance =
                            legacyUser.balance > BigInt(10000) ? legacyUser.balance - BigInt(10000) : BigInt(0);
                        if (extraBalance > BigInt(0) || legacyUser.lastDailyClaim) {
                            await prisma.user
                                .update({
                                    where: { id: canonicalJid },
                                    data: {
                                        ...(extraBalance > BigInt(0) ? { balance: { increment: extraBalance } } : {}),
                                        ...(legacyUser.lastDailyClaim
                                            ? { lastDailyClaim: legacyUser.lastDailyClaim }
                                            : {})
                                    }
                                })
                                .catch(() => {});
                        }
                        await prisma.user.delete({ where: { id: cleanDigits } }).catch(() => {});
                    }
                }

                const user = await prisma.user.findUnique({ where: { id: canonicalJid } });

                if (user) {
                    let updatedUsername: string | undefined = undefined;
                    // If user has no username, or their username was tracking their previous WhatsApp name
                    if (newWaName && (!user.username || user.username === user.pushName)) {
                        const collision = await prisma.user.findFirst({
                            where: { username: newWaName, NOT: { id: user.id } }
                        });
                        updatedUsername = collision
                            ? cleanDigits
                                ? `${newWaName}_${cleanDigits.slice(-4)}`
                                : undefined
                            : newWaName;
                    }

                    await prisma.user.update({
                        where: { id: canonicalJid },
                        data: {
                            ...(newWaName ? { pushName: newWaName } : {}),
                            ...(updatedUsername ? { username: updatedUsername } : {}),
                            ...(senderLidDb ? { lid: senderLidDb } : {})
                        }
                    });
                } else {
                    await prisma.user.create({
                        data: {
                            id: canonicalJid,
                            lid: senderLidDb || null,
                            pushName: newWaName,
                            username: newWaName
                        }
                    });
                }
            } catch (err) {
                console.error('[Message Handler] Error synchronizing user profile:', err);
            }
        })();
    }

    const senderRaw = senderJidDb ? cleanId(senderJidDb) || '' : senderLidDb || '';

    const sessionStore = dbContext.getStore();
    const currentSessionId = sessionStore?.sessionId || 'default';
    const isSubBot = currentSessionId !== 'default';
    const subBotNumber = isSubBot ? currentSessionId.replace(/^sub_/, '') : null;
    const subBotConfig = subBotNumber ? loadConfig(subBotNumber) : null;

    const subBotOwnerRaw = subBotConfig ? cleanId(subBotConfig.ownerJid) : null;
    const isOwner =
        Boolean(msg.key.fromMe) ||
        (botRawJid !== null && senderRaw === botRawJid) ||
        (botRawLid !== null && senderRaw === botRawLid) ||
        (subBotOwnerRaw !== null && senderRaw === subBotOwnerRaw) ||
        (senderRaw !== '' && ownerNumbers.includes(senderRaw));

    // If sub-bot is operating in self-bot mode, only the owner can interact
    if (isSubBot && subBotConfig?.mode === 'self' && !isOwner) {
        return;
    }

    // Resolve chat language preference (Hierarchy: Group -> User -> SubBot Default -> id)
    let chatLang: string | null = null;
    try {
        if (jid.endsWith('@g.us')) {
            const group = await prisma.whitelistedGroup.findUnique({ where: { jid } });
            if (group?.language) {
                chatLang = group.language.toLowerCase();
            }
        }
        if (!chatLang) {
            let user = senderJidDb
                ? await prisma.user.findFirst({
                      where: { OR: [{ id: senderJidDb }, { lid: senderJidDb }] }
                  })
                : null;
            if (!user && senderLidDb && senderLidDb !== senderJidDb) {
                user = await prisma.user.findFirst({
                    where: { OR: [{ id: senderLidDb }, { lid: senderLidDb }] }
                });
            }
            if (user?.language) {
                chatLang = user.language.toLowerCase();
            }
        }
    } catch {
        /* fallback to default */
    }

    if (!chatLang && subBotConfig?.language) {
        chatLang = subBotConfig.language.toLowerCase();
    }
    if (!chatLang) {
        chatLang = 'id';
    }

    const t = getTranslator(chatLang);

    const trimmedText = text.trim();

    // Check if it's a bare number replying to a play search result
    let isPlayReply = false;
    if (/^\d+$/.test(trimmedText)) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg) {
            const extText = quotedMsg.extendedTextMessage;
            const quotedText = quotedMsg.conversation || extText?.text || extText?.matchedText || '';
            const quotedLower = quotedText.toLowerCase();
            if (
                quotedLower.includes('(1-') ||
                quotedLower.includes('reply with a number') ||
                quotedLower.includes('balas dengan nomor') ||
                quotedLower.includes('balas dengan angka') ||
                quotedLower.includes('results for') ||
                quotedLower.includes('hasil teratas untuk')
            ) {
                isPlayReply = true;
            }
        }
    }

    const activePrefix = subBotConfig?.prefix || '.';
    const startsWithActivePrefix = trimmedText.startsWith(activePrefix);
    const startsWithDot = trimmedText.startsWith('.');
    const isCommand = startsWithActivePrefix || startsWithDot || isPlayReply;

    const lowerText = trimmedText.toLowerCase();
    const isCancelKeyword =
        lowerText === '.cancel' ||
        lowerText === 'cancel' ||
        lowerText === '.batal' ||
        lowerText === 'batal' ||
        lowerText === '.abort' ||
        lowerText === 'abort';

    let isQuotingCommand = false;
    if (msg.key.fromMe && msg.message) {
        const qMsg =
            msg.message.videoMessage?.contextInfo?.quotedMessage ||
            msg.message.imageMessage?.contextInfo?.quotedMessage ||
            msg.message.documentMessage?.contextInfo?.quotedMessage ||
            msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
        if (qMsg) {
            const qText = qMsg.conversation || qMsg.extendedTextMessage?.text || '';
            if (qText.trim().startsWith('.') || (activePrefix !== '.' && qText.trim().startsWith(activePrefix))) {
                isQuotingCommand = true;
            }
        }
    }

    const contextInfo =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        msg.message?.documentMessage?.contextInfo ||
        msg.message?.audioMessage?.contextInfo ||
        msg.message?.stickerMessage?.contextInfo;

    const mentionedJids: string[] = contextInfo?.mentionedJid || [];
    const isBotMentioned = mentionedJids.some((j: string) => {
        const raw = cleanId(j);
        return (botRawJid && raw === botRawJid) || (botRawLid && raw === botRawLid);
    });

    const repliedToJid = contextInfo?.participant;
    const repliedToRaw = cleanId(repliedToJid);
    const isQuotingBot = Boolean(
        contextInfo?.quotedMessage &&
        ((botRawJid && repliedToRaw === botRawJid) || (botRawLid && repliedToRaw === botRawLid))
    );

    const isStickerlyActiveInChat = hasActiveStickerlySession(jid);
    const isInInteractiveSession = Boolean(
        (senderRaw && isCancelKeyword && (hasCancellableSession(senderRaw, jid) || isStickerlyActiveInChat)) ||
        (senderRaw && !isQuotingCommand && isUserRegistering(senderRaw, jid)) ||
        (senderRaw && hasCancellableSession(senderRaw, jid)) ||
        isStickerlyActiveInChat
    );

    const isAutoStickerTrigger = Boolean(
        (!isSubBot || isFeatureEnabled(subBotNumber!, 'autosticker')) &&
        isAutoStickerEnabled(jid) &&
        hasDirectMedia(msg.message)
    );

    const isAutoDlTrigger = Boolean(
        (!isSubBot || isFeatureEnabled(subBotNumber!, 'autodl')) && /(https?:\/\/[^\s]+)/.test(trimmedText)
    );

    const isOwnerAutoCorrect = Boolean(
        isOwner &&
        Boolean(msg.key.fromMe) &&
        (!isSubBot || isFeatureEnabled(subBotNumber!, 'autocorrection')) &&
        isAutoCorrectionEnabled(jid)
    );

    if (jid === 'status@broadcast' || jid.endsWith('@newsletter')) {
        return;
    }

    const isDirectChat = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid');
    const isUserInteracting =
        isDirectChat ||
        isCommand ||
        isBotMentioned ||
        isQuotingBot ||
        isInInteractiveSession ||
        isAutoStickerTrigger ||
        isAutoDlTrigger ||
        isOwnerAutoCorrect;

    // To avoid being detected as a bot by Meta/WhatsApp, the "online" and "read"
    // statuses only work and are active when the user interacts with or performs an action on the bot.
    if (!isUserInteracting) {
        return;
    }

    markMessageRead(sock, msg);
    markPresenceActive(sock, jid);

    try {
        if (isCancelKeyword && isStickerlyActiveInChat) {
            const session = getStickerlySession(jid);
            if (session) {
                clearTimeout(session.timer);
                unregisterCancellableSessionByUser(session.userJid, jid);
                if (senderRaw) unregisterCancellableSessionByUser(senderRaw, jid);
                const allKeys = [...session.previewMessageKeys];
                if (session.guideMessageKey) {
                    allKeys.push(session.guideMessageKey);
                }
                await deletePreviewMessages(sock, jid, allKeys);
                await removeScheduledDeletions(jid, allKeys.map((k) => k.id!).filter(Boolean));
                deleteStickerlySession(jid);
                await sock.sendMessage(jid, { text: t('media.stickerly.cancelled') }, { quoted: msg });
                return;
            }
        }

        if (senderRaw && isCancelKeyword && hasCancellableSession(senderRaw, jid)) {
            const cancelMsg = await cancelActiveSession(senderRaw, jid, sock, msg, t);
            if (cancelMsg && typeof cancelMsg === 'string' && cancelMsg.trim().length > 0) {
                await sock.sendMessage(jid, { text: cancelMsg }, { quoted: msg });
            }
            return;
        }

        // Check if sender is currently in an active ID Card registration flow in this chat
        if (senderRaw && !isQuotingCommand && isUserRegistering(senderRaw, jid)) {
            if (!trimmedText.startsWith('.')) {
                const handled = await processRegistrationStep(sock, msg, senderRaw, jid, trimmedText, t);
                if (handled) return;
            }
        }

        // Check if sender is confirming a pending AI agent action (.confirm / confirm)
        if (senderRaw) {
            const handledAgentConfirm = await AgentConfirmationManager.processConfirmation(
                sock,
                msg,
                senderRaw,
                jid,
                trimmedText
            );
            if (handledAgentConfirm) return;
        }

        // Check if sender is sharing/forwarding a location in an active agent location sharing flow
        if (senderRaw) {
            const handledLocationForward = await AgentLocationStager.processLocationForwarding(
                sock,
                msg,
                senderRaw,
                jid,
                trimmedText
            );
            if (handledLocationForward) return;
        }

        // Check if sender is confirming a pending bank transfer
        if (senderRaw && !trimmedText.startsWith('.')) {
            const handledBankConfirm = await processBankTransferConfirmation(sock, msg, senderRaw, jid, trimmedText, t);
            if (handledBankConfirm) return;
        }

        // Check if sender is confirming a pending loan application
        if (senderRaw && !trimmedText.startsWith('.')) {
            const handledLoanConfirm = await processLoanConfirmation(sock, msg, senderRaw, jid, trimmedText, t);
            if (handledLoanConfirm) return;
        }

        // Check if sender is selecting a sticker pack from active Sticker.ly search
        if (isStickerlyActiveInChat) {
            const handledStickerly = await processStickerlySelection(sock, msg, senderRaw || '', jid, trimmedText, t);
            if (handledStickerly) return;
        }

        // Check if sender is in an active job application selection flow
        if (senderRaw && !trimmedText.startsWith('.')) {
            const handledJobSelect = await processJobSelection(sock, msg, senderRaw, jid, trimmedText, t);
            if (handledJobSelect) return;
        }

        if (isCommand) {
            let commandName: string;
            let argsStr: string;

            if (isPlayReply) {
                commandName = '.play';
                argsStr = trimmedText;
            } else {
                const parts = trimmedText.split(/\s+/);
                let rawCmd = parts[0];
                if (startsWithActivePrefix && activePrefix !== '.') {
                    rawCmd = '.' + rawCmd.slice(activePrefix.length);
                }
                commandName = rawCmd;
                argsStr = trimmedText.substring(parts[0].length).trim();

                // Multi-word command resolution (attempt two-token lookup before single-token)
                if (parts.length >= 2) {
                    const twoTokenCandidate = `${rawCmd} ${parts[1]}`;
                    if (toolsHandler.getTool(twoTokenCandidate)) {
                        commandName = twoTokenCandidate;
                        const match = trimmedText.match(/^\S+\s+\S+/);
                        argsStr = match ? trimmedText.substring(match[0].length).trim() : '';
                    }
                }
            }

            if (commandName === '.addgroup' || commandName === '.addwhitelist') {
                console.log('Command executed', { command: '.addgroup', jid });
                if (!jid.endsWith('@g.us')) {
                    await sock.sendMessage(jid, { text: t('core.group_only') });
                    return;
                }
                const { QuotaService, executeWithUserLock } = await import('#services/quotaService.js');
                const senderIdentity = senderJidDb || senderLidDb || '';
                // Re-adding must never transfer ownership: whoever whitelisted first keeps it,
                // whether that was the bot owner (global entry) or another user.
                const alreadyWhitelisted = await prisma.whitelistedGroup.findUnique({ where: { jid } });
                if (alreadyWhitelisted) {
                    await sock.sendMessage(jid, { text: t('core.group_already_whitelisted') }, { quoted: msg });
                    return;
                }
                if (isOwner) {
                    const success = await addGroup(jid, null);
                    if (success) {
                        await sock.sendMessage(jid, { text: t('core.group_add_success') });
                    } else {
                        await sock.sendMessage(jid, { text: t('core.group_add_failed') });
                    }
                    return;
                }
                try {
                    const result = await executeWithUserLock(senderIdentity, async () => {
                        const check = await QuotaService.canAddGroup(senderIdentity, false);
                        if (!check.allowed) return check;
                        const ok = await addGroup(jid, senderIdentity);
                        if (!ok) return null;
                        // Close the race: a concurrent adder may have won the row first.
                        const row = await prisma.whitelistedGroup.findUnique({ where: { jid } });
                        if ((row as { ownerJid?: string | null } | null)?.ownerJid !== senderIdentity) {
                            return { already: true as const };
                        }
                        return check;
                    });
                    if (result && 'already' in result) {
                        await sock.sendMessage(jid, { text: t('core.group_already_whitelisted') }, { quoted: msg });
                        return;
                    }
                    if (!result || !result.allowed) {
                        const reason = result?.reason ?? '';
                        const tierLabel = result?.tier ?? 'FREE';
                        await sock.sendMessage(jid, {
                            text: t('core.whitelist_limit_reached', {
                                tier: tierLabel,
                                reason
                            })
                        });
                        return;
                    }
                    await sock.sendMessage(jid, { text: t('core.group_add_success') });
                } catch (err) {
                    console.error('[Quota] .addgroup failed:', err);
                    await sock.sendMessage(jid, { text: t('core.group_add_failed') }, { quoted: msg });
                }
                return;
            }

            if (commandName === '.delgroup' || commandName === '.removewhitelist') {
                console.log('Command executed', { command: '.delgroup', jid });
                if (!jid.endsWith('@g.us')) {
                    await sock.sendMessage(jid, { text: t('core.group_only') });
                    return;
                }
                const senderIdentity = senderJidDb || senderLidDb || '';
                try {
                    const group = await prisma.whitelistedGroup.findUnique({ where: { jid } });
                    if (!group) {
                        await sock.sendMessage(jid, { text: t('core.group_not_whitelisted') }, { quoted: msg });
                        return;
                    }
                    const groupOwner = (group as { ownerJid?: string | null }).ownerJid ?? null;
                    if (!isOwner && groupOwner !== senderIdentity) {
                        await sock.sendMessage(jid, { text: t('core.owner_only') }, { quoted: msg });
                        return;
                    }
                    await prisma.whitelistedGroup.delete({ where: { jid } });
                    await sock.sendMessage(jid, { text: t('core.group_remove_success') }, { quoted: msg });
                } catch (err) {
                    console.error('[Quota] .delgroup failed:', err);
                    await sock.sendMessage(jid, { text: t('core.group_add_failed') }, { quoted: msg });
                }
                return;
            }

            const tool = toolsHandler.getTool(commandName);
            if (tool) {
                // Check sub-bot feature toggles
                if (isSubBot && subBotNumber) {
                    const reqFeature = getRequiredFeatureForTool(tool.definition?.name || '');
                    if (reqFeature && !isFeatureEnabled(subBotNumber, reqFeature)) {
                        console.log(
                            `[FeatureGate] Sub-bot +${subBotNumber} has feature '${reqFeature}' disabled. Rejecting command '${commandName}'.`
                        );
                        return;
                    }
                }

                // Check owner permission constraints
                const isOwnerOnly = tool.definition?.owner === true;
                if (isOwnerOnly && !isOwner) {
                    await sock.sendMessage(jid, { text: t('core.owner_only') }, { quoted: msg });
                    return;
                }

                if (jid.endsWith('@g.us') && !isOwner) {
                    const whitelisted = await isGroupWhitelisted(jid);
                    if (!whitelisted) return;
                }

                console.log('Command executed', { command: commandName, jid });
                console.log('[Message Handler] Command:', commandName, 'key details:', JSON.stringify(msg.key));

                let args: Record<string, any> = {};
                const props = tool.definition?.parameters?.properties;
                if (props) {
                    const keys = Object.keys(props);
                    if (keys.length === 1) {
                        args[keys[0]] = argsStr;
                    } else if (keys.length > 1) {
                        try {
                            args = JSON.parse(argsStr);
                        } catch {
                            args[keys[0]] = argsStr;
                        }
                    }
                }

                // Fix quote previews for LIDs: replace raw LID numbers in the message text with pushnames or phone numbers
                // We do this by modifying `msg` in place before execution, so tools quoting this `msg` have a readable preview.
                if (msg.message) {
                    const msgKeys = ['extendedTextMessage', 'imageMessage', 'videoMessage'] as const;
                    for (const msgKey of msgKeys) {
                        const msgContent = msg.message[msgKey];
                        if (msgContent) {
                            const textKey = msgKey === 'extendedTextMessage' ? 'text' : 'caption';
                            let currentText = (msgContent as any)[textKey] as string | null | undefined;
                            const mentionedJids = msgContent.contextInfo?.mentionedJid;

                            if (currentText && mentionedJids && mentionedJids.length > 0) {
                                let groupParticipants: any[] = [];
                                if (jid.endsWith('@g.us')) {
                                    try {
                                        const meta = await sock.groupMetadata(jid);
                                        groupParticipants = meta.participants;
                                    } catch {
                                        // ignore error
                                    }
                                }

                                for (const mJid of mentionedJids) {
                                    if (mJid.endsWith('@lid')) {
                                        const lidNum = mJid.split('@')[0];
                                        if (currentText.includes(`@${lidNum}`)) {
                                            let resolvedJid = mJid;
                                            const participant = groupParticipants.find((p: any) => p.lid === mJid);
                                            if (participant && participant.id) {
                                                resolvedJid = participant.id;
                                            }

                                            const searchJid = resolvedJid.endsWith('@lid') ? null : resolvedJid;
                                            let replacement = `@${lidNum}`; // fallback

                                            if (searchJid) {
                                                const jidNum = searchJid.split('@')[0];
                                                replacement = `@${jidNum}`; // phone fallback
                                                try {
                                                    const user = await prisma.user.findUnique({
                                                        where: { id: jidNum }
                                                    });
                                                    if (user && user.pushName) {
                                                        replacement = `@${user.pushName}`;
                                                    }
                                                } catch {
                                                    // ignore error
                                                }
                                            }

                                            currentText = currentText.replace(
                                                new RegExp(`@${lidNum}`, 'g'),
                                                replacement
                                            );
                                        }
                                    }
                                }
                                (msgContent as any)[textKey] = currentText;
                            }
                        }
                    }
                }

                await sock.sendPresenceUpdate('composing', jid);
                const result = await toolsHandler.execute(commandName, args, { sock, msg, jid, t });
                if (result && typeof result === 'string' && result.trim().length > 0) {
                    const matches = result.match(/@(\d+)/g);
                    const mentions = matches ? formatMentions(matches.map((m) => m.substring(1))) : [];
                    await sock.sendMessage(jid, { text: result, mentions }, { quoted: msg });
                }

                const legacyCanonical = getLegacyCanonical(commandName);
                if (legacyCanonical) {
                    const deprecationMsg = t('tools.deprecation_notice', { canonical: legacyCanonical });
                    await sock.sendMessage(jid, { text: deprecationMsg }, { quoted: msg });
                }
                return;
            }
        }

        // Offline AI Responder
        if (!isOwner) {
            if (!isSubBot || isFeatureEnabled(subBotNumber!, 'offlineAi')) {
                const handled = await handleOfflineAiResponder(sock, msg, jid, text, chatLang);
                if (handled) return;
            }
        }

        // Auto-correct processing for owner's sent text messages
        if (
            isOwner &&
            Boolean(msg.key.fromMe) &&
            (!isSubBot || isFeatureEnabled(subBotNumber!, 'autocorrection')) &&
            isAutoCorrectionEnabled(jid)
        ) {
            const msgId = msg.key.id;
            if (msgId && trimmedText.length > 1 && !isCommand) {
                try {
                    const corrected = await analyzeAndCorrectText(trimmedText);
                    if (corrected && corrected !== trimmedText) {
                        console.log('Auto-correct executed', { jid, original: trimmedText, corrected });
                        console.log(`[Auto-Correct] Editing message in ${jid}: "${trimmedText}" -> "${corrected}"`);
                        await sock.sendMessage(jid, { text: corrected, edit: msg.key });
                    }
                } catch (err: any) {
                    console.error('[Auto-Correct Error]', err);
                    console.error('Auto-correct handler failed', { error: err.message });
                }
            }
        }

        // Auto-DL Processing
        const isBotResponseStr =
            msg.key.fromMe &&
            ((text && (text.startsWith('✅') || text.startsWith('⏳') || text.startsWith('❌'))) || false); // we will evaluate isQuotingCommand properly below

        if (!isBotResponseStr && trimmedText && !isCommand) {
            if (!isSubBot || isFeatureEnabled(subBotNumber!, 'autodl')) {
                if (jid.endsWith('@g.us') && !isOwner) {
                    const whitelisted = await isGroupWhitelisted(jid);
                    if (whitelisted) {
                        await processAutoDl(sock, msg, jid, trimmedText);
                    }
                } else {
                    await processAutoDl(sock, msg, jid, trimmedText);
                }
            }
        }

        // Auto sticker processing if enabled for this chat and message contains direct media
        // Ignore programmatic bot responses (which usually start with ✅, ⏳, or ❌, or quote a command) to prevent loops
        isQuotingCommand = false;
        if (msg.key.fromMe && msg.message) {
            const qMsg =
                msg.message.videoMessage?.contextInfo?.quotedMessage ||
                msg.message.imageMessage?.contextInfo?.quotedMessage ||
                msg.message.documentMessage?.contextInfo?.quotedMessage ||
                msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (qMsg) {
                const qText = qMsg.conversation || qMsg.extendedTextMessage?.text || '';
                if (qText.trim().startsWith('.') || (activePrefix !== '.' && qText.trim().startsWith(activePrefix))) {
                    isQuotingCommand = true;
                }
            }
        }

        const isBotResponse =
            msg.key.fromMe &&
            ((text && (text.startsWith('✅') || text.startsWith('⏳') || text.startsWith('❌'))) || isQuotingCommand);
        if (
            !isBotResponse &&
            (!isSubBot || isFeatureEnabled(subBotNumber!, 'autosticker')) &&
            isAutoStickerEnabled(jid) &&
            hasDirectMedia(msg.message)
        ) {
            if (jid.endsWith('@g.us') && !isOwner) {
                const whitelisted = await isGroupWhitelisted(jid);
                if (!whitelisted) return;
            }

            console.log('Auto sticker executed', { jid });
            console.log('[Message Handler] Auto sticker executing for jid:', jid);

            await sock.sendPresenceUpdate('composing', jid);
            const result = await toolsHandler.execute('sticker_maker', {}, { sock, msg, jid, t });
            if (result && typeof result === 'string' && result.trim().length > 0 && !result.startsWith('✅')) {
                await sock.sendMessage(jid, { text: result }, { quoted: msg });
            }
            return;
        }
    } finally {
        markPresenceInactive(sock, jid);
    }
}
