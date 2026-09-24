import { WASocket } from '@whiskeysockets/baileys';
import { prisma } from '../../db.js';
import { decryptString } from '../storageEncryption.js';
import { EphemeralTokenStore } from './tokenStore.js';
import { cleanPhoneNumber, toCanonicalJid } from '../../utils/phone.js';
import { isOwnerId } from '../../utils/owner.js';

export interface ResolvedTarget {
    recipientToken: string;
    aliasMatch?: string;
    pushName?: string;
    resolvedJid: string;
}

export class AgentEntityResolver {
    /**
     * Resolves a target recipient string (alias or direct phone number) to a zero-knowledge token.
     */
    public static async resolveRecipientToken(
        query: string,
        callerJid: string,
        _sock?: WASocket
    ): Promise<ResolvedTarget | null> {
        if (!query || typeof query !== 'string') return null;

        const cleanQuery = query.trim().toLowerCase().replace(/^@/, '');

        // 1. Query UserContactBook table (scoped strictly by ownerJid)
        try {
            const contact = await prisma.userContactBook.findUnique({
                where: {
                    ownerJid_alias: {
                        ownerJid: callerJid,
                        alias: cleanQuery
                    }
                }
            });

            if (contact) {
                const realJid = decryptString(contact.encryptedJid);
                const token = EphemeralTokenStore.mintToken(realJid, callerJid);
                return {
                    recipientToken: token,
                    aliasMatch: contact.alias,
                    pushName: contact.alias,
                    resolvedJid: realJid
                };
            }
        } catch (err) {
            console.error('[AgentEntityResolver] Error querying UserContactBook:', err);
        }

        // 2. Direct phone number pattern (Requires registered KTP or owner)
        const digits = cleanPhoneNumber(cleanQuery);
        if (digits.length >= 10 && digits.length <= 15) {
            const user = await prisma.user.findUnique({
                where: { id: callerJid },
                include: { idCard: true }
            });
            const isOwner = isOwnerId(callerJid);
            const isRegisteredKtp = Boolean(user?.idCard);

            if (!isOwner && !isRegisteredKtp) {
                // Prevent unauthenticated callers from using bot as an open SMS/WhatsApp relay
                console.warn(`[AgentEntityResolver] Blocked direct number minting for unverified caller: ${callerJid}`);
                return null;
            }

            const canonicalJid = toCanonicalJid(digits);
            const token = EphemeralTokenStore.mintToken(
                canonicalJid,
                callerJid,
                new Set(['send_message', 'send_location'])
            );

            return {
                recipientToken: token,
                aliasMatch: 'direct_number',
                resolvedJid: canonicalJid
            };
        }

        return null;
    }
}
