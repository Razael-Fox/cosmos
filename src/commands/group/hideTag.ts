import { lookup } from 'node:dns/promises';
import { ToolDefinition, ToolContext, ToolModule } from '../types.js';
import { cleanId, formatMentions } from '#lib/casino.js';
import { getCachedMessage } from '#lib/messageCache.js';
import { ModerationService } from '#services/moderationService.js';
import { downloadContentFromMessage as baileysDownload } from '@whiskeysockets/baileys';

export const MAX_HIDETAG_BYTES = 100 * 1024; // 100 KB
export const MAX_HIDETAG_CHARS = 4000;
const FETCH_TIMEOUT_MS = 10 * 1000; // 10 s
const MAX_REDIRECT_HOPS = 3;

// Test seam so the suite can stub media download without touching Baileys.
export const hideTagDeps: { downloadDocument: typeof baileysDownload } = { downloadDocument: baileysDownload };

export const definition: ToolDefinition = {
    name: 'tag hide',
    title: 'Hidden Tag All',
    displayNames: { en: 'tag hide', id: 'tandai sembunyi' },
    category: 'Group',
    aliases: ['hidetag', 'ht', 'tag hide', 'tandai sembunyi', '.hidetag', '.ht', '.tag hide', '.tandai sembunyi'],
    description: 'Tag all group members invisibly with an announcement. Admin only.',
    descriptionKey: 'tools.commands.tag_hide.description',
    limitKey: 'hidetag',
    limit: { max: 3, windowMs: 600_000 },
    parameters: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'Inline text, quoted reply text, attached .txt/.md document, or raw file URL'
            }
        },
        required: []
    }
};

function toDigits(idStr: string | null | undefined): string {
    if (!idStr) return '';
    return idStr.split(':')[0].split('@')[0].replace(/\D/g, '');
}

function isPhoneDigits(s: string): boolean {
    return /^\d{8,15}$/.test(s);
}

function extractQuotedText(quoted: any): string {
    if (!quoted || typeof quoted !== 'object') return '';
    if (typeof quoted.conversation === 'string' && quoted.conversation.trim()) return quoted.conversation.trim();
    const ext = quoted.extendedTextMessage;
    if (ext && typeof ext.text === 'string' && ext.text.trim()) return ext.text.trim();
    for (const key of ['imageMessage', 'videoMessage', 'documentMessage'] as const) {
        const caption = (quoted as any)[key]?.caption;
        if (typeof caption === 'string' && caption.trim()) return caption.trim();
    }
    return '';
}

function fileSizeHint(docMsg: any): number {
    const raw = docMsg?.fileLength;
    if (typeof raw === 'number') return raw;
    if (raw && typeof raw === 'object' && typeof (raw as { low?: unknown }).low === 'number') {
        return (raw as { low: number }).low;
    }
    return 0;
}

function isPublicIpLiteral(ip: string): boolean {
    if (ip.includes(':')) {
        const lower = ip.toLowerCase();
        // IPv4-mapped IPv6: judge the inner IPv4 address.
        const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped) return isPublicIpLiteral(mapped[1]);
        if (lower === '::' || lower === '::1') return false;
        // Multicast ff00::/8, link-local fe80::/10, unique-local fc00::/7,
        // documentation 2001:db8::/32, discard 100::/64.
        if (/^(ff|fe[89ab])/.test(lower.replace(/:/g, ''))) return false;
        if (/^fc|^fd/.test(lower.replace(/:/g, ''))) return false;
        if (lower.startsWith('2001:db8')) return false;
        if (lower.startsWith('100::')) return false;
        return true;
    }
    const octets = ip.split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)) return false;
    if ((a === 192 && (b === 0 || b === 168)) || (a === 192 && b === 88)) return false;
    if ((a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0)) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64.0.0/10
    if (a >= 224) return false; // Multicast + reserved
    return true;
}

async function isPublicHttpUrl(raw: string): Promise<boolean> {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (!parsed.hostname || parsed.username || parsed.password) return false;
    try {
        const addresses = await lookup(parsed.hostname, { all: true });
        if (addresses.length === 0) return false;
        return addresses.every((entry) => isPublicIpLiteral(entry.address));
    } catch {
        return false;
    }
}

type FetchOutcome =
    | { ok: true; text: string }
    | { ok: false; reason: 'BLOCKED' | 'NETWORK' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' };

async function defaultAllowUrl(raw: string): Promise<boolean> {
    return isPublicHttpUrl(raw);
}

export async function fetchUrlText(
    startUrl: string,
    allowUrl: (raw: string) => Promise<boolean> = defaultAllowUrl
): Promise<FetchOutcome> {
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        // SSRF boundary: every hop (including redirect targets) must resolve
        // to public addresses only; redirects are followed manually so each
        // target is revalidated instead of trusting fetch's built-in follower.
        if (!(await allowUrl(current))) return { ok: false, reason: 'BLOCKED' };
        let res: Response;
        try {
            res = await fetch(current, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'manual' });
        } catch (err) {
            console.error('[hidetag] URL fetch failed:', err instanceof Error ? err.message : err);
            return { ok: false, reason: 'NETWORK' };
        }
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get('location');
            await res.body?.cancel().catch(() => {});
            if (!location || hop === MAX_REDIRECT_HOPS) return { ok: false, reason: 'NETWORK' };
            try {
                current = new URL(location, current).toString();
            } catch {
                return { ok: false, reason: 'NETWORK' };
            }
            continue;
        }
        if (!res.ok) {
            await res.body?.cancel().catch(() => {});
            return { ok: false, reason: 'NETWORK' };
        }
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType && !contentType.startsWith('text/') && !contentType.includes('json') && !contentType.includes('markdown')) {
            await res.body?.cancel().catch(() => {});
            return { ok: false, reason: 'UNSUPPORTED_TYPE' };
        }
        const announced = Number(res.headers.get('content-length'));
        if (Number.isFinite(announced) && announced > MAX_HIDETAG_BYTES) {
            await res.body?.cancel().catch(() => {});
            return { ok: false, reason: 'TOO_LARGE' };
        }
        // Stream with a running counter: the cap is enforced while reading so
        // a missing or understated Content-Length cannot OOM the process.
        const chunks: Buffer[] = [];
        let total = 0;
        try {
            for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
                total += (chunk as Uint8Array).byteLength;
                if (total > MAX_HIDETAG_BYTES) {
                    await res.body?.cancel().catch(() => {});
                    return { ok: false, reason: 'TOO_LARGE' };
                }
                chunks.push(Buffer.from(chunk as Uint8Array));
            }
        } catch (err) {
            console.error('[hidetag] URL body read failed:', err instanceof Error ? err.message : err);
            return { ok: false, reason: 'NETWORK' };
        }
        return { ok: true, text: Buffer.concat(chunks).toString('utf-8').trim() };
    }
    return { ok: false, reason: 'NETWORK' };
}

async function readDocumentText(docMsg: any): Promise<{ ok: true; text: string } | { ok: false; reason: 'TOO_LARGE' | 'READ_ERROR' }> {
    let stream: AsyncIterable<unknown>;
    try {
        stream = await hideTagDeps.downloadDocument(docMsg, 'document');
    } catch (err) {
        console.error('[hidetag] Error downloading document:', err);
        return { ok: false, reason: 'READ_ERROR' };
    }
    // Running byte counter (not Buffer.concat per chunk): the client-declared
    // fileLength is only a hint, the counter is the enforcement.
    const chunks: Buffer[] = [];
    let total = 0;
    try {
        for await (const chunk of stream as AsyncIterable<Buffer>) {
            total += (chunk as Buffer).length;
            if (total > MAX_HIDETAG_BYTES) {
                try {
                    (stream as unknown as { destroy?: () => void }).destroy?.();
                } catch {
                    /* ignore */
                }
                return { ok: false, reason: 'TOO_LARGE' };
            }
            chunks.push(chunk as Buffer);
        }
    } catch (err) {
        console.error('[hidetag] Error reading document stream:', err);
        return { ok: false, reason: 'READ_ERROR' };
    }
    return { ok: true, text: Buffer.concat(chunks).toString('utf-8').trim() };
}

export async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | void> {
    const { sock, msg, jid, t } = ctx;

    if (!jid.endsWith('@g.us')) {
        return t('tools.tag_hide.group_only');
    }

    // Dual-identifier admin check: LID-masked senders may only resolve via the
    // participantAlt/remoteJidAlt companion identifier (message.ts:211-236).
    const key = msg.key as Record<string, string | undefined>;
    const callerCandidates = [...new Set([key.participant, key.remoteJid, key.participantAlt, key.remoteJidAlt])].filter(
        (v): v is string => Boolean(v)
    );
    const modService = new ModerationService(sock);
    let isAdmin = false;
    for (const candidate of callerCandidates) {
        if (await modService.isUserAdmin(jid, candidate)) {
            isAdmin = true;
            break;
        }
    }
    if (!isAdmin) {
        return t('tools.tag_hide.caller_not_admin');
    }

    const inlineText =
        typeof args.message === 'string' && args.message.trim().length > 0
            ? args.message.trim()
            : typeof ctx.argsStr === 'string' && ctx.argsStr.trim().length > 0
              ? ctx.argsStr.trim()
              : '';

    let body = '';

    // 1. Attached .txt/.md document in the same message (caption holds the command).
    // An attached document owns the body slot even when it reads empty: falling
    // through to the quoted reply would announce surprising text.
    const docMsg = msg.message?.documentMessage;
    if (docMsg) {
        const fileName = (docMsg.fileName || '').toLowerCase();
        if (!fileName.endsWith('.txt') && !fileName.endsWith('.md')) {
            return t('tools.tag_hide.unsupported_file');
        }
        if (fileSizeHint(docMsg) > MAX_HIDETAG_BYTES) {
            return t('tools.tag_hide.file_too_large');
        }
        const doc = await readDocumentText(docMsg);
        if (!doc.ok) {
            return doc.reason === 'TOO_LARGE'
                ? t('tools.tag_hide.file_too_large')
                : t('tools.tag_hide.error', { error: 'Failed to read document' });
        }
        if (!doc.text) {
            return t('tools.tag_hide.empty');
        }
        body = doc.text;
    }

    // 2. Raw-file URL in args, else direct text.
    if (!body && inlineText) {
        if (/^https?:\/\/\S+$/i.test(inlineText)) {
            const fetched = await fetchUrlText(inlineText);
            if (!fetched.ok) {
                if (fetched.reason === 'TOO_LARGE') return t('tools.tag_hide.url_too_large');
                if (fetched.reason === 'UNSUPPORTED_TYPE') return t('tools.tag_hide.url_unsupported_type');
                // Generic on purpose: raw dial/DNS internals must not leak
                // into chat (handler re-derives mentions from @digits, too).
                return t('tools.tag_hide.fetch_failed');
            }
            if (!fetched.text) {
                return t('tools.tag_hide.empty');
            }
            body = fetched.text;
        } else {
            body = inlineText;
        }
    }

    // 3. Reply context (explicit args win over implicit quote).
    if (!body) {
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        const quoted = contextInfo?.quotedMessage;
        body = extractQuotedText(quoted);
        if (!body && contextInfo?.stanzaId) {
            body = extractQuotedText(getCachedMessage(contextInfo.stanzaId));
        }
    }

    if (!body) {
        return t('tools.tag_hide.usage');
    }

    if (body.length > MAX_HIDETAG_CHARS) {
        return t('tools.tag_hide.too_long');
    }

    // 4. Resolve taggable members from ONE metadata snapshot, excluding the bot.
    let participants: Array<{ id?: string; lid?: string }>;
    try {
        const metadata = await sock.groupMetadata(jid);
        participants = Array.isArray(metadata?.participants) ? metadata.participants : [];
    } catch (err) {
        console.error('[hidetag] Failed to fetch group metadata:', err);
        return t('tools.tag_hide.error', { error: 'Failed to read member list' });
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

    // LID→phone map from the same snapshot: no per-member metadata refetch.
    const lidToPhone = new Map<string, string>();
    for (const p of participants) {
        const pLid = cleanId((p as { lid?: string }).lid);
        const pPhone = p.id ? cleanId(p.id) : '';
        if (pLid && isPhoneDigits(pPhone)) lidToPhone.set(pLid, pPhone);
    }

    const mentions: string[] = [];
    for (const p of participants) {
        const rawId = p.id;
        const rawLid = (p as { lid?: string }).lid;
        const digitId = toDigits(rawId);
        const digitLid = toDigits(rawLid);
        if (!digitId && !digitLid) continue;
        if ((digitId && botIds.has(digitId)) || (digitLid && botIds.has(digitLid))) continue;
        const cleanRawId = rawId ? cleanId(rawId) : '';
        const cleanRawLid = rawLid ? cleanId(rawLid) : '';
        if ((cleanRawId && botIds.has(cleanRawId)) || (cleanRawLid && botIds.has(cleanRawLid))) continue;

        let mention: string | undefined;
        if (rawId?.endsWith('@s.whatsapp.net') && isPhoneDigits(cleanRawId)) {
            mention = rawId;
        } else {
            const lidKey = cleanRawLid || (rawId?.endsWith('@lid') ? cleanRawId : '');
            const phone = lidKey ? lidToPhone.get(lidKey) : undefined;
            if (phone) {
                mention = `${phone}@s.whatsapp.net`;
            } else {
                const target = rawId || rawLid;
                if (target) mention = target;
            }
        }
        if (mention) mentions.push(...formatMentions(mention));
    }

    if (mentions.length === 0) {
        return t('tools.tag_hide.no_members');
    }

    // Self-send with invisible padding so no visible @-list leaks into the body.
    // Must return void: the handler re-derives mentions from @digits in returned
    // strings and would double-send.
    try {
        await sock.sendMessage(jid, { text: `${body}\n\u200B`, mentions });
    } catch (err) {
        console.error('[hidetag] Failed to send announcement:', err);
        return t('tools.tag_hide.error', { error: 'Failed to deliver announcement' });
    }
}

export default { definition, execute } as ToolModule;
