import { ToolDefinition, ToolContext } from './types.js';
import { cleanId, getSenderJid } from '../utils/casino.js';
import { unwrapMonospace } from '../utils/monospace.js';
import { getCachedMessage } from '../utils/messageCache.js';
import { renderAlert, renderCard, renderSyntaxError, CardField } from '../utils/uiFormatter.js';

const COOLDOWN_MS = 10 * 1000;
const lastCheckedAt = new Map<string, number>();

// The lookbehind keeps `evilwhatsapp.com/channel/...` from matching the host.
const INVITE_RE = /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]{10,})/i;

export interface NewsletterRef {
    jid?: string;
    name?: string;
    serverMessageId?: number;
    code?: string;
}

type Source = 'link' | 'reply_link' | 'forward';

/** Returns the channel invite code found in `text`, if any. */
export function extractChannelInvite(text: string | null | undefined): string | undefined {
    return text?.match(INVITE_RE)?.[1];
}

const WRAPPERS = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'ephemeralMessage'];
const CONTEXT_HOLDERS = ['extendedTextMessage', 'imageMessage', 'videoMessage', 'documentMessage', 'audioMessage'];

function unwrap(m: any): any {
    for (const w of WRAPPERS) if (m?.[w]?.message) return unwrap(m[w].message);
    return m;
}

/**
 * Reads a channel reference from a (quoted) message. A forwarded-from-channel
 * marker wins over a link in the text, since it needs no lookup.
 */
export function findNewsletterRef(message: any): NewsletterRef | undefined {
    const m = unwrap(message);
    if (!m) return undefined;

    for (const k of CONTEXT_HOLDERS) {
        const fwd = m[k]?.contextInfo?.forwardedNewsletterMessageInfo;
        if (fwd?.newsletterJid) {
            return { jid: fwd.newsletterJid, name: fwd.newsletterName, serverMessageId: fwd.serverMessageId };
        }
    }

    const text = m.conversation ?? CONTEXT_HOLDERS.map((k) => m[k]?.text ?? m[k]?.caption).find(Boolean);
    const code = extractChannelInvite(text);
    return code ? { code } : undefined;
}

function pruneCooldowns(now: number): void {
    for (const [key, stamp] of lastCheckedAt.entries()) {
        if (now - stamp >= COOLDOWN_MS) lastCheckedAt.delete(key);
    }
}

interface ChannelMeta {
    id?: string;
    name?: string;
    subscribers?: number | string;
    verification?: string;
    invite?: string;
    creation_time?: number | string;
    thread_metadata?: Record<string, any>;
}

/**
 * Baileys `newsletterMetadata()` hands back the raw WMex result, so a live reply
 * keeps the details under `thread_metadata` (with a nested `name.text`) instead
 * of the flat shape. Flatten it, preferring any top-level field already set.
 */
function flattenMeta(raw: ChannelMeta | null): ChannelMeta | null {
    const thread = raw?.thread_metadata;
    if (!raw || !thread) return raw;
    return {
        ...raw,
        name: raw.name ?? thread.name?.text,
        subscribers: raw.subscribers ?? thread.subscribers_count,
        verification: raw.verification ?? thread.verification,
        invite: raw.invite ?? thread.invite,
        creation_time: raw.creation_time ?? thread.creation_time
    };
}

function buildCard(id: string, meta: ChannelMeta | null, ref: NewsletterRef, source: Source, ctx: ToolContext): string {
    const { t } = ctx;
    const fields: CardField[] = [];
    const name = meta?.name || ref.name;
    if (name) fields.push({ icon: '📛', label: t('tools.check_chid.label_name'), value: name });
    if (meta) {
        const subs = Number(meta.subscribers);
        if (meta.subscribers != null && Number.isFinite(subs)) {
            fields.push({
                icon: '👥',
                label: t('tools.check_chid.label_followers'),
                value: subs.toLocaleString(ctx.lang)
            });
        }
        if (meta.verification) {
            fields.push({
                icon: '✅',
                label: t('tools.check_chid.label_verified'),
                value: t(meta.verification === 'VERIFIED' ? 'tools.check_chid.yes' : 'tools.check_chid.no')
            });
        }
        if (meta.invite) {
            fields.push({
                icon: '🔗',
                label: t('tools.check_chid.label_invite'),
                value: `https://whatsapp.com/channel/${meta.invite}`
            });
        }
        const created = new Date(Number(meta.creation_time) * 1000);
        if (meta.creation_time != null && !Number.isNaN(created.getTime())) {
            fields.push({
                icon: '📅',
                label: t('tools.check_chid.label_created'),
                value: created.toISOString().slice(0, 10)
            });
        }
    } else if (ref.serverMessageId != null) {
        fields.push({ icon: '🧾', label: t('tools.check_chid.label_message_id'), value: ref.serverMessageId });
    }

    return renderCard({
        icon: '📢',
        title: t('tools.check_chid.title'),
        subtitle: t(`tools.check_chid.subtitle_${source}`),
        body: [`\`\`\`${id}\`\`\``],
        fields,
        ...(meta ? { tip: t('tools.check_chid.tip_copy') } : { footer: t('tools.check_chid.partial_note') }),
        t
    });
}

export const definition: ToolDefinition = {
    name: 'check chid',
    title: 'Check Channel ID',
    displayNames: { en: 'check chid', id: 'cek chid' },
    category: 'Tools & Utilities',
    aliases: ['check chid', 'cek chid', '.check chid', '.cek chid'],
    description:
        'Resolve a WhatsApp channel ID (@newsletter) from a channel link, a replied message containing a link, or a replied message forwarded from a channel.',
    descriptionKey: 'tools.commands.check_chid.description',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    void _args;
    const { sock, msg, jid, t } = ctx;
    const reply = (text: string) => sock.sendMessage(jid, { text }, { quoted: msg });
    const alert = (type: 'error' | 'info' | 'warning', key: string, suggest = true) =>
        reply(
            renderAlert({
                type,
                title: t(`tools.check_chid.${key}_title`),
                message: t(`tools.check_chid.${key}_message`),
                actionSuggestion: suggest ? t(`tools.check_chid.${key}_suggestion`) : undefined,
                t
            })
        );

    const arg = unwrapMonospace(ctx.argsStr ?? '').text;
    const info = (msg.message as any)?.extendedTextMessage?.contextInfo;
    const quoted = info?.quotedMessage ? (getCachedMessage(info.stanzaId) ?? info.quotedMessage) : undefined;

    if (!arg && !quoted) {
        await reply(
            renderSyntaxError(
                'check chid',
                t('tools.check_chid.syntax_issue'),
                '.check chid <url>',
                t('tools.check_chid.syntax_examples'),
                t
            )
        );
        return;
    }

    // Precedence: argument URL, then forward info / URL on the quoted message.
    let ref: NewsletterRef | undefined;
    let source: Source = 'link';
    if (arg) {
        const code = extractChannelInvite(arg);
        if (!code) return void (await alert('error', 'invalid_link'));
        ref = { code };
    } else {
        ref = findNewsletterRef(quoted);
        if (!ref) return void (await alert('info', 'no_channel', false));
        source = ref.jid ? 'forward' : 'reply_link';
    }

    const now = Date.now();
    pruneCooldowns(now);
    const senderIdentity = cleanId(getSenderJid(msg, sock)) || cleanId(msg.key?.participant) || msg.key?.id;
    const cooldownKey = `${jid}:${senderIdentity}`;
    const elapsed = now - (lastCheckedAt.get(cooldownKey) ?? 0);
    if (elapsed < COOLDOWN_MS) {
        const seconds = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        await reply(t('tools.check_chid.cooldown', { seconds }));
        return;
    }
    lastCheckedAt.set(cooldownKey, now);

    try {
        if (ref.jid) {
            // Forwarded: the ID is already known; metadata is optional enrichment.
            let meta: ChannelMeta | null = null;
            try {
                meta = flattenMeta((await sock.newsletterMetadata('jid', ref.jid)) as ChannelMeta | null);
            } catch (err) {
                console.error('[Check Chid] Optional metadata enrichment failed:', err);
            }
            await reply(buildCard(ref.jid, meta, ref, source, ctx));
            return;
        }

        const meta = flattenMeta((await sock.newsletterMetadata('invite', ref.code!)) as ChannelMeta | null);
        if (!meta?.id) return void (await alert('warning', 'not_found'));
        console.log(`[Check Chid] Resolved ${meta.id} for ${jid}`);
        await reply(buildCard(meta.id, meta, ref, source, ctx));
    } catch (err) {
        console.error('[Check Chid] Lookup failed:', err);
        await alert('error', 'lookup_failed');
    }
}

export default { definition, execute };
