import { WASocket } from '@whiskeysockets/baileys';
import { prisma, dbContext } from '../../db.js';
import { decryptString } from '../storageEncryption.js';
import { EphemeralTokenStore } from './tokenStore.js';
import { cleanPhoneNumber, toCanonicalJid } from '../../utils/phone.js';
import { isOwnerId, getPrimaryOwnerNumber } from '../../utils/owner.js';
import { loadConfig } from '../subBotConfigService.js';
import { cleanId } from '../../utils/casino.js';
import { getCachedParticipatingGroups } from './prompts/contextResolver.js';
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
        sock?: WASocket,
        isOwner?: boolean,
        callerLid?: string
    ): Promise<ResolvedTarget | null> {
        if (!query || typeof query !== 'string') return null;

        const cleanQuery = query.trim().toLowerCase().replace(/^@/, '');

        // 1. Query UserContactBook table (scoped strictly by ownerJid)
        try {
            let contact = await prisma.userContactBook.findUnique({
                where: {
                    ownerJid_alias: {
                        ownerJid: callerJid,
                        alias: cleanQuery
                    }
                }
            });

            if (!contact) {
                const allContacts = await prisma.userContactBook.findMany({
                    where: { ownerJid: callerJid }
                });
                contact = allContacts.find((c) => c.alias.trim().toLowerCase() === cleanQuery) || null;
            }

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

        // 2. Owner and System Aliases (e.g., 'Razael', 'Owner', 'Pemilik', 'Creator')
        try {
            const sessionStore = dbContext.getStore();
            const currentSessionId = sessionStore?.sessionId || 'default';
            const isSubBot = currentSessionId !== 'default';
            const subBotNumber = isSubBot ? currentSessionId.replace(/^sub_/, '') : undefined;
            let ownerJid: string | null = null;
            const ownerDisplayName = 'Razael';

            if (subBotNumber) {
                try {
                    const subBotConfig = loadConfig(subBotNumber);
                    if (subBotConfig?.ownerJid) {
                        ownerJid = toCanonicalJid(subBotConfig.ownerJid);
                    }
                } catch {
                    // Ignore
                }
            }

            if (!ownerJid) {
                const primaryOwner = getPrimaryOwnerNumber();
                if (primaryOwner) {
                    ownerJid = toCanonicalJid(primaryOwner);
                }
            }

            if (ownerJid) {
                const isOwnerAlias =
                    cleanQuery === 'owner' ||
                    cleanQuery === 'razael' ||
                    cleanQuery === 'pemilik' ||
                    cleanQuery === 'creator' ||
                    cleanQuery === 'developer' ||
                    cleanQuery === ownerDisplayName.toLowerCase();

                if (isOwnerAlias) {
                    const token = EphemeralTokenStore.mintToken(
                        ownerJid,
                        callerJid,
                        new Set(['send_message', 'send_location'])
                    );
                    return {
                        recipientToken: token,
                        aliasMatch: cleanQuery,
                        pushName: ownerDisplayName,
                        resolvedJid: ownerJid
                    };
                }
            }
        } catch (ownerErr) {
            console.error('[AgentEntityResolver] Error resolving owner alias:', ownerErr);
        }

        // 3. Direct phone number pattern (Requires registered KTP or owner)
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

        // 4. WhatsApp Group Target Resolution
        if (sock) {
            try {
                const effectiveIsOwner = isOwner !== undefined ? isOwner : isOwnerId(callerJid);
                const callerClean = cleanId(callerJid);
                const callerLidClean = callerLid ? cleanId(callerLid) : undefined;

                // Normalize query by removing common group prefixes
                const normalizedGroupQuery = cleanQuery
                    .replace(/^(grup|group)\s+/i, '')
                    .replace(/^the\s+/i, '')
                    .trim();

                const allGroups = await getCachedParticipatingGroups(sock);
                for (const [groupId, meta] of Object.entries(allGroups)) {
                    if (!groupId || !groupId.endsWith('@g.us') || !meta) continue;

                    const groupSubject = meta.subject ? String(meta.subject).trim() : '';
                    const cleanSubject = groupSubject.toLowerCase();

                    // Check if query matches group subject
                    const isDirectMatch =
                        cleanSubject === cleanQuery ||
                        cleanSubject === normalizedGroupQuery ||
                        (normalizedGroupQuery.length >= 3 && cleanSubject.includes(normalizedGroupQuery)) ||
                        (cleanQuery.length >= 3 && cleanSubject.includes(cleanQuery));

                    if (!isDirectMatch) continue;

                    // Verify caller authorization for this group
                    let isParticipant = effectiveIsOwner;
                    let isCallerAdmin = effectiveIsOwner;

                    if (!isParticipant && Array.isArray(meta.participants)) {
                        for (const p of meta.participants) {
                            const pIdClean = cleanId(p.id);
                            const pLidClean = p.lid ? cleanId(p.lid) : undefined;
                            if (
                                pIdClean === callerClean ||
                                (callerLidClean && pIdClean === callerLidClean) ||
                                (pLidClean && pLidClean === callerClean) ||
                                (callerLidClean && pLidClean && pLidClean === callerLidClean)
                            ) {
                                isParticipant = true;
                                if (p.admin === 'admin' || p.admin === 'superadmin') {
                                    isCallerAdmin = true;
                                }
                                break;
                            }
                        }
                    }

                    if (!isParticipant) {
                        console.warn(
                            `[AgentEntityResolver] Blocked group token resolution for caller ${callerJid} into group ${groupId} (not a participant)`
                        );
                        return null;
                    }

                    // Check announcement group restriction
                    if (meta.announce && !isCallerAdmin && !effectiveIsOwner) {
                        console.warn(
                            `[AgentEntityResolver] Blocked group token resolution for caller ${callerJid} into announcement group ${groupId} (not admin)`
                        );
                        return null;
                    }

                    const token = EphemeralTokenStore.mintToken(
                        groupId,
                        callerJid,
                        new Set(['send_message', 'send_location'])
                    );

                    return {
                        recipientToken: token,
                        aliasMatch: groupSubject,
                        pushName: groupSubject,
                        resolvedJid: groupId
                    };
                }
            } catch (groupErr) {
                console.error('[AgentEntityResolver] Error resolving group alias:', groupErr);
            }
        }

        return null;
    }
}
