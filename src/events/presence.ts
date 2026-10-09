import { updateUserPresence } from '#services/presenceService.js';
import type { EventSocket } from './eventContext.js';

export function registerPresenceEvents(sock: EventSocket): void {
    sock.ev.on('presence.update', ({ id, presences }) => {
        if (presences) {
            for (const [participant, presence] of Object.entries(presences)) {
                const target = participant || id;
                if (target && presence) {
                    updateUserPresence(target, presence.lastKnownPresence, (presence as any).lastSeen).catch(() => {});
                }
            }
        } else if (id) {
            updateUserPresence(id, 'available').catch(() => {});
        }
    });
}
