import { isAutoWhitelistEnabled, isAutoArchiveEnabled } from '#services/systemConfigService.js';
import { isFeatureEnabled } from '#services/subBotConfigService.js';
import { archiveChat } from '#services/chatArchiveService.js';
import { addGroup } from '#db.js';
import { cleanId } from '#lib/casino.js';
import { ModerationService } from '#services/moderationService.js';
import { BlacklistEnforcer } from '#services/blacklistEnforcer.js';
import type { EventSocket } from './eventContext.js';

export function registerParticipantEvents(sock: EventSocket, sessionId: string): void {
    const modService = new ModerationService(sock);
    const blacklistEnforcer = new BlacklistEnforcer(sock, modService);
    blacklistEnforcer.startListening(sessionId);

    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        try {
            if (action === 'add' && Array.isArray(participants) && id && id.endsWith('@g.us')) {
                const botId = cleanId(sock.user?.id);
                const botLid = cleanId((sock.user as Record<string, unknown> | undefined)?.lid as string | undefined);
                const isBotAdded = participants.some((p) => {
                    let pId = '';
                    if (typeof p === 'string') {
                        pId = p;
                    } else if (typeof p === 'object' && p !== null && 'id' in p && typeof p.id === 'string') {
                        pId = p.id;
                    }
                    const cleanP = cleanId(pId);
                    return cleanP === botId || (Boolean(botLid) && cleanP === botLid);
                });

                if (isBotAdded) {
                    if (isAutoWhitelistEnabled()) {
                        await addGroup(id, null);
                        console.log(
                            `[AutoWhitelist] [${sessionId}] Bot joined group ${id} - group automatically whitelisted.`
                        );
                    }

                    const isSubBot = sessionId.startsWith('sub_');
                    const subBotNumber = isSubBot ? sessionId.replace(/^sub_/, '') : undefined;
                    const shouldAutoArchive =
                        isSubBot && subBotNumber
                            ? isFeatureEnabled(subBotNumber, 'autoarchive') || isAutoArchiveEnabled()
                            : isAutoArchiveEnabled();

                    if (shouldAutoArchive) {
                        console.log(`[AutoArchive] [${sessionId}] Bot joined group ${id} - executing auto-archive.`);
                        archiveChat(sock, id).catch((archiveErr) => {
                            console.error(
                                `[AutoArchive] [${sessionId}] Failed to auto-archive group ${id}:`,
                                archiveErr
                            );
                        });
                    }
                }
            }
        } catch (err) {
            console.error(`[GroupParticipants] [${sessionId}] Error in group-participants.update handler:`, err);
        }
    });
}
