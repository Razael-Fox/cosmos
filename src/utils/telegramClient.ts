import fs from 'fs';
import os from 'os';
import path from 'path';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const SESSION_FILE = path.resolve(process.cwd(), 'storage', 'telegram_session.txt');

/** Transient directory for downloaded private media; files are removed after delivery. */
const TEMP_MEDIA_DIR = path.join(os.tmpdir(), 'waf-tgdl');

export interface TelegramPostRef {
    /** Numeric internal chat id as it appears in t.me/c/<id>/ links (positive digits only). */
    chatId: string | null;
    messageId: number | null;
    inviteHash: string | null;
    isPrivatePost: boolean;
    inviteLink: string | null;
}

/**
 * Extracts the private post reference or invite link from arbitrary text.
 * Private post links use the form https://t.me/c/<chatId>/<messageId>.
 */
export function parseTelegramPrivateRef(text: string): TelegramPostRef {
    const ref: TelegramPostRef = {
        chatId: null,
        messageId: null,
        inviteHash: null,
        isPrivatePost: false,
        inviteLink: null
    };
    if (!text) return ref;

    const postMatch = text.match(/https?:\/\/t\.me\/c\/(\d+)\/(\d+)/i);
    if (postMatch) {
        ref.chatId = postMatch[1];
        ref.messageId = parseInt(postMatch[2], 10);
        ref.isPrivatePost = true;
        return ref;
    }

    const inviteMatch = text.match(/https?:\/\/t(?:elegram)?\.(?:me|dog)\/(?:\+|joinchat\/)([A-Za-z0-9_-]+)/i);
    if (inviteMatch) {
        ref.inviteHash = inviteMatch[1];
        return ref;
    }

    return ref;
}

function getApiCredentials(): { apiId: number; apiHash: string } | null {
    const apiId = parseInt(process.env.TELEGRAM_API_ID || '', 10);
    const apiHash = process.env.TELEGRAM_API_HASH;
    if (!apiId || !apiHash) return null;
    return { apiId, apiHash };
}

function loadSavedSession(): string {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            return fs.readFileSync(SESSION_FILE, 'utf8').trim();
        }
    } catch (err) {
        console.error('[TelegramClient] Failed to read session file:', err);
    }
    return '';
}

/**
 * Checks whether the dummy Telegram account can be used
 * (API credentials present and a paired session exists).
 */
export function isTelegramConfigured(): boolean {
    return getApiCredentials() !== null && loadSavedSession().length > 0;
}

let clientInstance: TelegramClient | null = null;
let clientConnectPromise: Promise<TelegramClient> | null = null;

/**
 * Returns the connected dummy-account MTProto client.
 * The session must have been created beforehand via "pnpm tgpair".
 */
export async function getTelegramClient(): Promise<TelegramClient> {
    if (clientInstance && clientConnected(clientInstance)) return clientInstance;
    if (clientConnectPromise) return clientConnectPromise;

    const credentials = getApiCredentials();
    if (!credentials) {
        const { getTranslator } = await import('./i18n.js');
        throw new Error(getTranslator('en')('utilities.telegram.not_configured'));
    }
    const savedSession = loadSavedSession();
    if (!savedSession) {
        const { getTranslator } = await import('./i18n.js');
        throw new Error(getTranslator('en')('utilities.telegram.no_session'));
    }

    const client = new TelegramClient(new StringSession(savedSession), credentials.apiId, credentials.apiHash, {
        connectionRetries: 3
    });

    clientConnectPromise = (async () => {
        await client.connect();
        if (!(await client.isUserAuthorized())) {
            const { getTranslator } = await import('./i18n.js');
            throw new Error(getTranslator('en')('utilities.telegram.session_expired'));
        }
        console.log('[TelegramClient] Dummy account connected.');
        clientInstance = client;
        return client;
    })();

    try {
        return await clientConnectPromise;
    } catch (err) {
        console.error('[TelegramClient] Connection failed:', err);
        clientConnectPromise = null;
        throw err;
    }
}

function clientConnected(client: TelegramClient): boolean {
    try {
        return (client as unknown as { connected?: boolean }).connected === true;
    } catch {
        return false;
    }
}

/** Disconnects the client if it is active (used on graceful shutdown). */
export async function disconnectTelegramClient(): Promise<void> {
    if (clientInstance) {
        try {
            await clientInstance.disconnect();
        } catch {
            // Ignore disconnect errors during shutdown.
        }
        clientInstance = null;
        clientConnectPromise = null;
    }
}

export interface PrivateMediaFile {
    filePath: string;
    fileName: string;
    mimeType: string;
    kind: 'video' | 'image' | 'audio' | 'document';
    sizeBytes: number;
}

function classifyMedia(mimeType: string): PrivateMediaFile['kind'] {
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'document';
}

function extensionForMime(mimeType: string): string {
    const map: Record<string, string> = {
        'video/mp4': '.mp4',
        'video/webm': '.webm',
        'video/x-matroska': '.mkv',
        'video/quicktime': '.mov',
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'audio/mpeg': '.mp3',
        'audio/mp4': '.m4a',
        'audio/ogg': '.ogg'
    };
    return map[mimeType] || '';
}

/**
 * Downloads one media message from a registered private chat into a temporary
 * directory and returns its metadata. Enforces the 15MB WhatsApp size limit.
 */
export async function downloadPrivateMedia(chatId: string, messageId: number): Promise<PrivateMediaFile> {
    const client = await getTelegramClient();

    // /c/<id>/ links refer to channels and supergroups, which require the -100 prefix.
    const peer = `-100${chatId}`;
    const messages = await client.getMessages(peer, { ids: [messageId] });
    const message = messages[0];
    if (!message || !message.media) {
        throw new Error(
            'The message could not be retrieved. Please verify that the dummy account is still a member of that chat.'
        );
    }

    let mimeType = 'application/octet-stream';
    let fileName = `tg_${chatId}_${messageId}`;
    if (message.media instanceof Api.MessageMediaDocument && message.media.document instanceof Api.Document) {
        mimeType = message.media.document.mimeType || mimeType;
        const attr = message.media.document.attributes?.find(
            (a): a is Api.DocumentAttributeFilename => a.className === 'DocumentAttributeFilename'
        );
        if (attr?.fileName) fileName = attr.fileName;
    } else if (message.media instanceof Api.MessageMediaPhoto) {
        mimeType = 'image/jpeg';
    }

    const kind = classifyMedia(mimeType);
    const ext = path.extname(fileName) || extensionForMime(mimeType) || '.bin';
    if (!fs.existsSync(TEMP_MEDIA_DIR)) fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
    const filePath = path.join(TEMP_MEDIA_DIR, `tgdl_${Date.now()}_${chatId}_${messageId}${ext}`);

    await client.downloadMedia(message, { outputFile: filePath });

    const sizeBytes = fs.statSync(filePath).size;
    console.log(`[TelegramClient] Downloaded media ${fileName} (${sizeBytes} bytes) from chat ${chatId}.`);
    return { filePath, fileName: path.basename(fileName), mimeType, kind, sizeBytes };
}

export interface JoinedChatInfo {
    /** Normalized internal chat id (positive digits only, matching t.me/c/ links). */
    chatId: string;
    title: string | null;
}

/**
 * Joins the dummy account into a private chat using an invite hash and
 * returns the resolved chat identity for registration in the database.
 */
export async function joinChatViaInvite(inviteHash: string): Promise<JoinedChatInfo> {
    const client = await getTelegramClient();
    const result = await client.invoke(new Api.messages.ImportChatInvite({ hash: inviteHash }));

    // The response is an updates collection; only these variants carry the chat list.
    const chats =
        result instanceof Api.Updates ? result.chats : result instanceof Api.UpdatesCombined ? result.chats : [];

    for (const chat of chats) {
        if (chat instanceof Api.Channel) {
            return { chatId: String(chat.id), title: chat.title || null };
        }
        if (chat instanceof Api.Chat) {
            return { chatId: String(chat.id), title: chat.title || null };
        }
    }
    const { getTranslator } = await import('./i18n.js');
    throw new Error(getTranslator('en')('utilities.telegram.resolve_failed'));
}

/** Resolves the display title of a registered private chat id, when accessible. */
export async function resolveChatTitle(chatId: string): Promise<string | null> {
    try {
        const client = await getTelegramClient();
        const entity = await client.getEntity(`-100${chatId}`);
        if ('title' in entity && typeof entity.title === 'string') return entity.title;
        if ('firstName' in entity && typeof entity.firstName === 'string') return entity.firstName;
        return null;
    } catch (err) {
        console.error(`[TelegramClient] Could not resolve chat title for ${chatId}:`, err);
        return null;
    }
}
