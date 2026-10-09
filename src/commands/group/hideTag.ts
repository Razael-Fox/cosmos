import { ToolDefinition, ToolContext, ToolModule } from '../types.js';
import { cleanId, formatMentions, resolveId } from '#lib/casino.js';
import { getCachedMessage } from '#lib/messageCache.js';
import { ModerationService } from '#services/moderationService.js';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';

export const MAX_HIDETAG_BYTES = 100 * 1024; // 100 KB
const FETCH_TIMEOUT_MS = 10 * 1000; // 10 s

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

function fileSizeOf(docMsg: any): number {
    const raw = docMsg?.fileLength;
    if (typeof raw === 'number') return raw;
    if (raw && typeof raw === 'object' && typeof (raw as { low?: unknown }).low === 'number') {
        return (raw as { low: number }).low;
    }
    return 0;
}

async function readDocumentText(docMsg: any): Promise<string> {
    const stream = await downloadContentFromMessage(docMsg, 'document');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
        if (Buffer.concat(chunks).length > MAX_HIDETAG_BYTES) break;
    }
    return Buffer.concat(chunks).toString('utf-8').trim();
}

async function fetchUrlText(url: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    let res: Response;
    try {
        res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const announced = Number(res.headers.get('content-length'));
    if (Number.isFinite(announced) && announced > MAX_HIDETAG_BYTES) return { ok: false, error: 'TOO_LARGE' };
    let buffer: Buffer;
    try {
        buffer = Buffer.from(await res.arrayBuffer());
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (buffer.length > MAX_HIDETAG_BYTES) return { ok: false, error: 'TOO_LARGE' };
    return { ok: true, text: buffer.toString('utf-8').trim() };
}

export async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | void> {
    const { sock, msg, jid, t } = ctx;

    if (!jid.endsWith('@g.us')) {
        return t('tools.tag_hide.group_only');
    }

    const callerJid = msg.key.participant || msg.key.remoteJid || '';
    const modService = new ModerationService(sock);
    if (!(await modService.isUserAdmin(jid, callerJid))) {
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
    const docMsg = msg.message?.documentMessage;
    if (docMsg) {
        const fileName = (docMsg.fileName || '').toLowerCase();
        if (!fileName.endsWith('.txt') && !fileName.endsWith('.md')) {
            return t('tools.tag_hide.unsupported_file');
        }
        if (fileSizeOf(docMsg) > MAX_HIDETAG_BYTES) {
            return t('tools.tag_hide.file_too_large');
        }
        try {
            const text = await readDocumentText(docMsg);
            if (Buffer.byteLength(text, 'utf-8') > MAX_HIDETAG_BYTES) {
                return t('tools.tag_hide.file_too_large');
            }
            body = text;
        } catch (err) {
            console.error('[hidetag] Error downloading document:', err);
            return t('tools.tag_hide.error', { error: 'Failed to read document' });
        }
    }

    // 2. Raw-file URL in args, else direct text.
    if (!body && inlineText) {
        if (/^https?:\/\/\S+$/i.test(inlineText)) {
            const fetched = await fetchUrlText(inlineText);
            if (!fetched.ok) {
                return fetched.error === 'TOO_LARGE'
                    ? t('tools.tag_hide.url_too_large')
                    : t('tools.tag_hide.fetch_failed', { error: fetched.error });
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

    // 4. Resolve taggable members, excluding the bot itself.
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

        let phoneJid: string | undefined;
        const target = rawId || rawLid;
        if (target) {
            const resolved = await resolveId(target, sock, jid);
            if (resolved && resolved.length <= 14) {
                phoneJid = `${resolved}@s.whatsapp.net`;
            }
        }
        mentions.push(...formatMentions(phoneJid ?? target!));
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
        return t('tools.tag_hide.error', { error: err instanceof Error ? err.message : String(err) });
    }
}

export default { definition, execute } as ToolModule;
