import type { Contact } from '@whiskeysockets/baileys';
import { getPrismaClient } from '#db.js';
import type { EventSocket } from './eventContext.js';

export function registerContactEvents(sock: EventSocket, sessionId: string): void {
    const syncContacts = async (contacts: Partial<Contact>[]) => {
        const sessionPrisma = getPrismaClient(sessionId);
        for (const contact of contacts) {
            if (!contact.id) continue;
            const waName = contact.notify?.trim() || contact.name?.trim() || null;
            const waUsername = contact.username?.trim() || null;
            if (!waName && !waUsername) continue;

            const cleanDigits = contact.id.split('@')[0].replace(/\D/g, '');
            const canonicalJid = cleanDigits ? `${cleanDigits}@s.whatsapp.net` : contact.id;

            try {
                const existing = await sessionPrisma.user.findFirst({
                    where: {
                        OR: [{ id: canonicalJid }, ...(cleanDigits ? [{ id: cleanDigits }] : [])]
                    }
                });

                if (existing) {
                    let newUsername = existing.username;
                    if (!newUsername || newUsername === existing.pushName) {
                        const candidate = waUsername || waName;
                        if (candidate) {
                            const collision = await sessionPrisma.user.findFirst({
                                where: { username: candidate, NOT: { id: existing.id } }
                            });
                            newUsername = collision
                                ? cleanDigits
                                    ? `${candidate}_${cleanDigits.slice(-4)}`
                                    : null
                                : candidate;
                        }
                    }

                    await sessionPrisma.user.update({
                        where: { id: existing.id },
                        data: {
                            ...(waName ? { pushName: waName } : {}),
                            ...(newUsername ? { username: newUsername } : {})
                        }
                    });
                }
            } catch {
                // Non-blocking sync for individual contact
            }
        }
    };

    // Note: `sock` is unused here today — the handlers only touch the database.
    // It stays in the signature so every register function shares one shape.
    void sock;

    sock.ev.on('messaging-history.set', async ({ contacts }) => {
        if (contacts && contacts.length > 0) {
            console.log(`[Connection] [${sessionId}] Received ${contacts.length} contacts via messaging-history.set`);
            await syncContacts(contacts);
        }
    });

    sock.ev.on('contacts.upsert', async (contacts) => {
        if (contacts && contacts.length > 0) {
            await syncContacts(contacts);
        }
    });

    sock.ev.on('contacts.update', async (updates) => {
        if (updates && updates.length > 0) {
            await syncContacts(updates);
        }
    });
}
