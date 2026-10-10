import { ToolDefinition, ToolContext } from '../types.js';
import { buildUserOrConditions, cleanId, formatMentions, getSenderJid, resolveId } from '#lib/casino.js';
import { prisma } from '#db.js';
import { getAllOnlineIds } from '#services/presenceService.js';

const COOLDOWN_MS = 30 * 1000;
const lastCheckedAt = new Map<string, number>();

// Presence subscription is one-time per group: re-subscribing on every
// invocation is spam-shaped traffic, and the passive presence.update events
// keep the map fresh afterwards.
const subscribedGroups = new Set<string>();

function toDigits(idStr: string | null | undefined): string {
    if (!idStr) return '';
    return idStr.split(':')[0].split('@')[0].replace(/\D/g, '');
}

/**
 * Drops cooldown entries that are already expired so the in-memory map cannot
 * grow without bound across the lifetime of the process.
 */
function pruneCooldowns(now: number): void {
    for (const [key, stamp] of lastCheckedAt.entries()) {
        if (now - stamp >= COOLDOWN_MS) lastCheckedAt.delete(key);
    }
}
interface GroupParticipantLike {
    id?: string;
    lid?: string;
    name?: string;
    notify?: string;
    verifiedName?: string;
}

function buildEmptyCard(ctx: ToolContext): string {
    return (
        `> ${ctx.t('tools.check_online.empty_title')}\n` +
        `> ${ctx.t('tools.check_online.empty_body')}\n` +
        `> ${ctx.t('tools.check_online.empty_delay')}`
    );
}

export const definition: ToolDefinition = {
    name: 'check online',
    title: 'Check Online',
    displayNames: { en: 'check online', id: 'cek online' },
    category: 'Group',
    aliases: ['check online', 'cek online', '.check online', '.cek online'],
    description: 'List group members who are currently online based on the presence the bot has observed.',
    descriptionKey: 'tools.commands.check_online.description',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    void _args;
    const { sock, msg, jid } = ctx;

    if (!jid.endsWith('@g.us')) {
        await sock.sendMessage(jid, { text: ctx.t('tools.check_online.group_only') }, { quoted: msg });
        return;
    }

    const now = Date.now();
    pruneCooldowns(now);

    // Cooldown is scoped per group AND per sender so one member cannot lock
    // out the entire room.
    const senderJid = getSenderJid(msg, sock);
    const senderIdentity = cleanId(senderJid) || cleanId(msg.key?.participant) || msg.key?.id;
    if (!senderIdentity) {
        await sock.sendMessage(jid, { text: ctx.t('tools.check_online.fetch_error') }, { quoted: msg });
        return;
    }
    const cooldownKey = `${jid}:${senderIdentity}`;
    const lastAt = lastCheckedAt.get(cooldownKey) ?? 0;
    const elapsed = now - lastAt;
    if (elapsed < COOLDOWN_MS) {
        const seconds = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        await sock.sendMessage(jid, { text: ctx.t('tools.check_online.cooldown', { seconds }) }, { quoted: msg });
        return;
    }

    let fetchedParticipants: GroupParticipantLike[] | undefined;
    try {
        const metadata = await sock.groupMetadata(jid);
        fetchedParticipants = Array.isArray(metadata?.participants)
            ? (metadata.participants as unknown as GroupParticipantLike[])
            : [];
    } catch (err) {
        console.error('[Check Online] Failed to fetch group metadata:', err);
        await sock.sendMessage(jid, { text: ctx.t('tools.check_online.fetch_error') }, { quoted: msg });
        return;
    }
    const participants = fetchedParticipants ?? [];
    const total = participants.length;

    // Only consume the cooldown once the lookup actually succeeded.
    lastCheckedAt.set(cooldownKey, Date.now());

    if (!subscribedGroups.has(jid) && typeof sock.presenceSubscribe === 'function') {
        const targets = new Set<string>();
        for (const p of participants) {
            for (const candidate of [p.id, p.lid]) {
                if (candidate && candidate.endsWith('@s.whatsapp.net')) targets.add(candidate);
            }
        }
        if (targets.size === 0) {
            // Nothing subscribable; fall through to normal rendering.
        } else try {
            Promise.allSettled([...targets].map((target) => sock.presenceSubscribe(target)))
            .then((results) => {
                subscribedGroups.add(jid);
                const failed = results.filter((r) => r.status === 'rejected').length;
                console.log(`[Check Online] Presence subscribed for ${jid}: ${targets.size - failed}/${targets.size}`);
            })
            .catch((err) => {
                // Leave the group unmarked so a later invocation retries.
                console.error('[Check Online] Presence subscribe failed:', err);
            });
        } catch (err) {
            console.error('[Check Online] Presence subscribe failed:', err);
        }
    }

    if (total === 0) {
        await sock.sendMessage(jid, { text: buildEmptyCard(ctx) }, { quoted: msg });
        return;
    }

    const botIds = new Set<string>();
    const rawBotId = sock.user?.id as string | undefined;
    const rawBotLid = (sock.user as { lid?: string } | undefined)?.lid;
    for (const raw of [rawBotId, rawBotLid]) {
        if (!raw) continue;
        const cleaned = cleanId(raw);
        if (cleaned) botIds.add(cleaned);
        const digits = toDigits(raw);
        if (digits) botIds.add(digits);
    }

    const onlineSet = new Set(getAllOnlineIds());
    const mentions: string[] = [];
    const lines: string[] = [];

    for (const p of participants) {
        const rawId = p.id;
        const rawLid = p.lid;
        const digitId = toDigits(rawId);
        const digitLid = toDigits(rawLid);
        if (!digitId && !digitLid) continue;
        if ((digitId && botIds.has(digitId)) || (digitLid && botIds.has(digitLid))) continue;
        const cleanRawId = rawId ? cleanId(rawId) : '';
        const cleanRawLid = rawLid ? cleanId(rawLid) : '';
        if ((cleanRawId && botIds.has(cleanRawId)) || (cleanRawLid && botIds.has(cleanRawLid))) continue;

        // The presence map is populated passively, so a member is "tracked" once any
        // of its identifiers is present in the online set.
        const candidates = [digitId, cleanRawId, digitLid, cleanRawLid].filter((v): v is string => Boolean(v));
        if (!candidates.some((c) => onlineSet.has(c))) continue;

        let phoneJid = rawId && rawId.endsWith('@s.whatsapp.net') ? rawId : undefined;
        if (!phoneJid && rawLid) {
            const resolved = await resolveId(rawLid, sock, jid);
            if (resolved && resolved !== cleanRawLid && resolved.length <= 14) {
                phoneJid = `${resolved}@s.whatsapp.net`;
            }
        }
        if (!phoneJid && rawId) {
            const resolved = await resolveId(rawId, sock, jid);
            if (resolved && resolved !== cleanRawId && resolved.length <= 14) {
                phoneJid = `${resolved}@s.whatsapp.net`;
            }
        }

        let resolvedName: string | undefined = p.name || p.notify || p.verifiedName;
        if (!phoneJid) {
            const target = rawId || rawLid;
            if (target) {
                try {
                    const conditions = buildUserOrConditions(target);
                    if (conditions.length > 0) {
                        const dbUser = await prisma.user.findFirst({
                            where: { OR: conditions },
                            select: { id: true, pushName: true, username: true }
                        });
                        if (dbUser) {
                            if (dbUser.id && dbUser.id.endsWith('@s.whatsapp.net')) {
                                phoneJid = dbUser.id;
                            }
                            if (!resolvedName) {
                                resolvedName = dbUser.pushName || dbUser.username || undefined;
                            }
                        }
                    }
                } catch {
                    // Ignore DB lookup failure
                }
            }
        }

        if (phoneJid) {
            mentions.push(...formatMentions(phoneJid));
            lines.push(`@${cleanId(phoneJid)}`);
        } else {
            lines.push(resolvedName || ctx.t('tools.check_online.unknown_member'));
        }
    }

    if (lines.length === 0) {
        await sock.sendMessage(jid, { text: buildEmptyCard(ctx) }, { quoted: msg });
        return;
    }

    const title = ctx.t('tools.check_online.title');
    const summary = ctx.t('tools.check_online.summary', {
        online: lines.length
    });
    const badge = ctx.t('tools.check_online.online_badge');
    const freshness = ctx.t('tools.check_online.freshness_note');

    const numbered = lines.map((mention, idx) => `${idx + 1}. *${mention}* — ${badge}`).join('\n');
    const text = `*${title}*\n\n> ${summary}\n\n${numbered}\n\n> ${freshness}`;

    console.log(`[Check Online] ${lines.length}/${total} members online in ${jid}`);
    await sock.sendMessage(jid, { text, mentions }, { quoted: msg });
    return;
}

export default { definition, execute };
