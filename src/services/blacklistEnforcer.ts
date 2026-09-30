import { WASocket } from '@whiskeysockets/baileys';
import { ModerationService } from './moderationService.js';
import { cleanId, formatMentions } from '../utils/casino.js';

export class BlacklistEnforcer {
    private isListening = false;

    constructor(
        private sock: WASocket,
        private moderationService: ModerationService
    ) {}

    public startListening(): void {
        if (this.isListening) return;
        this.isListening = true;

        this.sock.ev.on('group-participants.update', async (update) => {
            try {
                const { id: groupJid, participants, action } = update;
                if (action !== 'add' || !groupJid || !groupJid.endsWith('@g.us') || !Array.isArray(participants)) {
                    return;
                }

                for (const p of participants) {
                    let participantJid = '';
                    if (typeof p === 'string') {
                        participantJid = p;
                    } else if (p && typeof p === 'object' && 'id' in p) {
                        const candidateId = p.id;
                        if (typeof candidateId === 'string') {
                            participantJid = candidateId;
                        }
                    }
                    if (!participantJid) continue;

                    const isBlacklisted = await this.moderationService.isBlacklisted(groupJid, participantJid);
                    if (isBlacklisted) {
                        await this.moderationService.kickMember(
                            groupJid,
                            participantJid,
                            'User is blacklisted from this group',
                            'SYSTEM'
                        );

                        const mentions = formatMentions(participantJid);
                        const displayId = cleanId(participantJid);
                        await this.sock.sendMessage(groupJid, {
                            text: `⚠️ @${displayId} was automatically removed because they are blacklisted from this group.`,
                            mentions
                        });
                    }
                }
            } catch (err) {
                console.error('[BlacklistEnforcer] Error enforcing blacklist on participant update:', err);
            }
        });
    }
}
