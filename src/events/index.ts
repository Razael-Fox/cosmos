import { registerConnectionEvents } from './connection.js';
import { registerContactEvents } from './contacts.js';
import { registerPresenceEvents } from './presence.js';
import { registerParticipantEvents } from './participants.js';
import { registerMessageEvents } from './messages.js';
import type { EventContext, EventSocket } from './eventContext.js';

export type { EventContext, EventSocket };

/**
 * Single ordered entry point for all Baileys socket event subscriptions.
 * Called from `connectToWhatsApp` in `src/lib/connectionManager.ts` at the
 * exact point where the subscriptions previously lived.
 *
 * Registration order is load-bearing (`connection.update` establishes
 * readiness; `messages.upsert` early-returns until it does) — do not reorder.
 */
export function registerEvents(sock: EventSocket, ctx: EventContext): void {
    registerConnectionEvents(sock, ctx);
    registerContactEvents(sock, ctx.sessionId);
    registerPresenceEvents(sock);
    registerParticipantEvents(sock, ctx.sessionId);
    registerMessageEvents(sock, ctx);
}
