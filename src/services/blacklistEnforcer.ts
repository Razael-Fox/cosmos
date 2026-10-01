import { WASocket, GroupMetadata } from '@whiskeysockets/baileys';
import { ModerationService, getParticipantLid } from './moderationService.js';
import { cleanId, formatMentions } from '../utils/casino.js';
import { prisma, dbContext, getPrismaClient } from '../db.js';
import { getTranslator } from '../utils/i18n.js';

export class BlacklistEnforcer {
    private isListening = false;

    constructor(
        private sock: WASocket,
        private moderationService: ModerationService
    ) {}

    public startListening(sessionId = 'default'): void {
        if (this.isListening) return;
        this.isListening = true;

        this.sock.ev.on('group-participants.update', async (update) => {
            await dbContext.run({ sessionId, prisma: getPrismaClient(sessionId) }, async () => {
                try {
                    const { id: groupJid, participants, action } = update;
                    if (action !== 'add' || !groupJid || !groupJid.endsWith('@g.us') || !Array.isArray(participants)) {
                        return;
                    }

                    let groupMetadata: GroupMetadata | undefined;
                    try {
                        groupMetadata = await this.sock.groupMetadata(groupJid);
                    } catch {
                        /* ignore groupMetadata resolution */
                    }

                    for (const p of participants) {
                        const candidateIdentities: string[] = [];
                        let socketTargetJid = '';

                        if (typeof p === 'string') {
                            candidateIdentities.push(p);
                            socketTargetJid = p;
                        } else if (p && typeof p === 'object' && 'id' in p) {
                            if (typeof p.id === 'string' && p.id) {
                                candidateIdentities.push(p.id);
                                socketTargetJid = p.id;
                            }
                            if ('phoneNumber' in p && typeof p.phoneNumber === 'string' && p.phoneNumber) {
                                candidateIdentities.push(p.phoneNumber);
                            }
                            if ('lid' in p && typeof p.lid === 'string' && p.lid) {
                                candidateIdentities.push(p.lid);
                            }
                        }

                        if (!socketTargetJid) continue;

                        // Check if only LID identities are present
                        const hasOnlyLid = candidateIdentities.every(
                            (c) => c.endsWith('@lid') || (cleanId(c)?.length || 0) > 14
                        );

                        // If only LID is present, attempt to resolve phone number mapping via group metadata
                        if (hasOnlyLid && groupMetadata?.participants) {
                            const matched = groupMetadata.participants.find((mp) => {
                                const mpClean = cleanId(mp.id);
                                const mpLid = getParticipantLid(mp);
                                return candidateIdentities.some((c) => {
                                    const cClean = cleanId(c);
                                    return mpClean === cClean || mpLid === cClean;
                                });
                            });
                            if (matched) {
                                if (matched.id && !matched.id.endsWith('@lid')) {
                                    candidateIdentities.push(matched.id);
                                }
                                if (
                                    'phoneNumber' in matched &&
                                    typeof matched.phoneNumber === 'string' &&
                                    matched.phoneNumber
                                ) {
                                    candidateIdentities.push(matched.phoneNumber);
                                }
                            }
                        }

                        // Also attempt to resolve phone/LID pairing via User database
                        try {
                            for (const c of [...candidateIdentities]) {
                                const cClean = cleanId(c);
                                const user = await prisma.user.findFirst({
                                    where: {
                                        OR: [
                                            { id: c },
                                            { id: `${cClean}@s.whatsapp.net` },
                                            { lid: c },
                                            { lid: cClean },
                                            { lid: `${cClean}@lid` }
                                        ]
                                    }
                                });
                                if (user) {
                                    if (user.id && !candidateIdentities.includes(user.id)) {
                                        candidateIdentities.push(user.id);
                                    }
                                    if (user.lid && !candidateIdentities.includes(user.lid)) {
                                        candidateIdentities.push(user.lid);
                                    }
                                }
                            }
                        } catch {
                            /* ignore DB lookup error */
                        }

                        let isBlacklisted = false;
                        for (const candidate of candidateIdentities) {
                            if (await this.moderationService.isBlacklisted(groupJid, candidate, groupMetadata)) {
                                isBlacklisted = true;
                                break;
                            }
                        }

                        if (isBlacklisted) {
                            const kickResult = await this.moderationService.kickMember(
                                groupJid,
                                socketTargetJid,
                                'User is blacklisted from this group',
                                'SYSTEM'
                            );

                            if (kickResult.success) {
                                let chatLang = 'id';
                                try {
                                    const group = await prisma.whitelistedGroup.findUnique({
                                        where: { jid: groupJid }
                                    });
                                    if (group?.language) {
                                        chatLang = group.language.toLowerCase();
                                    }
                                } catch {
                                    /* fallback to default */
                                }
                                const t = getTranslator(chatLang);

                                const mentions = formatMentions(socketTargetJid);
                                const displayId = cleanId(socketTargetJid);
                                await this.sock.sendMessage(groupJid, {
                                    text: t('tools.group_blacklist_add.auto_removed', { target: displayId }),
                                    mentions
                                });
                            } else {
                                console.error(
                                    `[BlacklistEnforcer] Failed to auto-kick blacklisted participant ${socketTargetJid} in ${groupJid}:`,
                                    kickResult.message,
                                    kickResult.data
                                );
                            }
                        }
                    }
                } catch (err) {
                    console.error('[BlacklistEnforcer] Error enforcing blacklist on participant update:', err);
                }
            });
        });
    }
}
