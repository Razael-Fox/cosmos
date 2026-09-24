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

/**
 * Normalizes a target query string by stripping quotes, mentions, and common conversational prefixes.
 */
export function cleanTargetQuery(query: string): string {
    return query
        .normalize('NFKC')
        .trim()
        .replace(/^@/, '')
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
        .replace(/^(ke|to|di|in|at)\s+/i, '')
        .replace(/^(grup|group|chat|room|the)\s+/i, '')
        .replace(/^(ke|to|di|in|at)\s+/i, '')
        .replace(/^(grup|group|chat|room|the)\s+/i, '')
        .trim();
}

/**
 * Computes a fuzzy match score (0 - 100) between a user query and a candidate name (group or alias).
 */
export function scoreTargetMatch(query: string, candidate: string): number {
    if (!query || !candidate) return 0;

    const normQ = query.normalize('NFKC').toLowerCase().trim();
    const normC = candidate.normalize('NFKC').toLowerCase().trim();

    if (!normQ || !normC) return 0;

    // 1. Direct exact match
    if (normQ === normC) return 100;

    // 2. Normalized words match (punctuation, symbols, multiple spaces collapsed)
    const wordsQ = normQ.replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
    const wordsC = normC.replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
    if (wordsQ && wordsC && wordsQ === wordsC) return 95;

    // 3. Canonical alphanumeric match (letters and numbers only)
    const canonQ = normQ.replace(/[^\p{L}\p{N}]+/gu, '');
    const canonC = normC.replace(/[^\p{L}\p{N}]+/gu, '');
    if (canonQ && canonC && canonQ === canonC) return 90;

    // 4. Prefix match on canonical or words (length >= 3)
    if (canonQ.length >= 3 && canonC.startsWith(canonQ)) return 80;
    if (wordsQ.length >= 3 && wordsC.startsWith(wordsQ)) return 75;

    // 5. Substring containment on canonical or words (length >= 3)
    if (canonQ.length >= 3 && canonC.includes(canonQ)) return 70;
    if (wordsQ.length >= 3 && wordsC.includes(wordsQ)) return 65;

    // 6. Token subset match (all words in query exist in candidate)
    const tokensQ = wordsQ.split(' ').filter(Boolean);
    const tokensC = wordsC.split(' ').filter(Boolean);
    if (tokensQ.length > 0 && tokensQ.every((t) => tokensC.includes(t))) return 60;

    return 0;
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

        const cleanQuery = query.normalize('NFKC').trim().toLowerCase().replace(/^@/, '');
        const cleanedTarget = cleanTargetQuery(query);
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

            if (!contact && cleanedTarget && cleanedTarget.toLowerCase() !== cleanQuery) {
                contact = await prisma.userContactBook.findUnique({
                    where: {
                        ownerJid_alias: {
                            ownerJid: callerJid,
                            alias: cleanedTarget.toLowerCase()
                        }
                    }
                });
            }

            if (!contact) {
                const allContacts = await prisma.userContactBook.findMany({
                    where: { ownerJid: callerJid }
                });

                let bestContact: (typeof allContacts)[0] | null = null;
                let bestScore = 0;

                for (const c of allContacts) {
                    const score1 = scoreTargetMatch(cleanQuery, c.alias);
                    const score2 = cleanedTarget ? scoreTargetMatch(cleanedTarget, c.alias) : 0;
                    const maxScore = Math.max(score1, score2);

                    if (maxScore >= 60 && maxScore > bestScore) {
                        bestScore = maxScore;
                        bestContact = c;
                    }
                }
                contact = bestContact;
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
                const targetToCheck = cleanedTarget.toLowerCase();
                const isOwnerAlias =
                    cleanQuery === 'owner' ||
                    cleanQuery === 'razael' ||
                    cleanQuery === 'pemilik' ||
                    cleanQuery === 'creator' ||
                    cleanQuery === 'developer' ||
                    cleanQuery === ownerDisplayName.toLowerCase() ||
                    targetToCheck === 'owner' ||
                    targetToCheck === 'razael' ||
                    targetToCheck === 'pemilik' ||
                    targetToCheck === 'creator' ||
                    targetToCheck === 'developer' ||
                    targetToCheck === ownerDisplayName.toLowerCase();

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
        const digits = cleanPhoneNumber(cleanedTarget || cleanQuery);
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

                const allGroups = await getCachedParticipatingGroups(sock);

                interface GroupCandidateMatch {
                    groupId: string;
                    meta: Record<string, unknown>;
                    subject: string;
                    score: number;
                }
                let bestMatch: GroupCandidateMatch | null = null;

                for (const [groupId, meta] of Object.entries(allGroups)) {
                    if (!groupId || !groupId.endsWith('@g.us') || !meta) continue;

                    const groupSubject = meta.subject ? String(meta.subject).trim() : '';
                    if (!groupSubject) continue;

                    const score1 = scoreTargetMatch(cleanQuery, groupSubject);
                    const score2 = cleanedTarget ? scoreTargetMatch(cleanedTarget, groupSubject) : 0;
                    const maxScore = Math.max(score1, score2);

                    if (maxScore >= 60 && (!bestMatch || maxScore > bestMatch.score)) {
                        bestMatch = {
                            groupId,
                            meta,
                            subject: groupSubject,
                            score: maxScore
                        };
                    }
                }

                if (bestMatch) {
                    const { groupId, meta, subject: groupSubject } = bestMatch;

                    // Verify caller authorization for this group
                    let isParticipant = effectiveIsOwner;
                    let isCallerAdmin = effectiveIsOwner;

                    const participants = Array.isArray(meta.participants)
                        ? (meta.participants as Array<{ id?: string; lid?: string; admin?: string | null }>)
                        : [];

                    if (!isParticipant && participants.length > 0) {
                        for (const p of participants) {
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
