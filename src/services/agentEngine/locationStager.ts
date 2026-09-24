import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { cleanId } from '../../utils/casino.js';
import { registerCancellableSession, unregisterCancellableSession } from '../../utils/cancellationManager.js';
import { EphemeralTokenStore } from './tokenStore.js';

export interface StagedLocationSession {
    sessionId: string;
    userJid: string;
    userLid?: string;
    chatJid: string;
    targetToken: string;
    targetAlias: string;
    subBotOwnerName: string;
    createdAt: number;
    expiresAt: number;
}

const activeLocationSessions = new Map<string, StagedLocationSession>();
const LOCATION_TTL_MS = 180_000; // 3 minutes

export class AgentLocationStager {
    private static getLookupKey(userJid: string, chatJid: string): string {
        const u = cleanId(userJid) || userJid;
        const c = cleanId(chatJid) || chatJid;
        return `${u}_${c}`;
    }

    /**
     * Registers an interactive location forwarding session ("shareloc" flow).
     */
    public static registerSession(session: Omit<StagedLocationSession, 'createdAt' | 'expiresAt'>): void {
        const now = Date.now();
        const fullSession: StagedLocationSession = {
            ...session,
            createdAt: now,
            expiresAt: now + LOCATION_TTL_MS
        };

        const key = this.getLookupKey(session.userJid, session.chatJid);
        activeLocationSessions.set(key, fullSession);

        registerCancellableSession({
            sessionId: session.sessionId,
            feature: 'location_forward',
            userJid: session.userJid,
            chatJid: session.chatJid,
            description: `Forward location to ${session.targetAlias}`,
            onCancel: async (sock: WASocket, msg: WAMessage) => {
                activeLocationSessions.delete(key);
                await sock.sendMessage(
                    session.chatJid,
                    { text: `❌ Cancelled location sharing for ${session.targetAlias}.` },
                    { quoted: msg }
                );
            }
        });
    }

    public static findSession(userJid: string, chatJid: string): StagedLocationSession | undefined {
        const key = this.getLookupKey(userJid, chatJid);
        const session = activeLocationSessions.get(key);
        if (!session) return undefined;

        if (Date.now() > session.expiresAt) {
            activeLocationSessions.delete(key);
            unregisterCancellableSession(session.sessionId);
            return undefined;
        }

        return session;
    }

    /**
     * Intercepts messages to detect shared locations and forward them to the staged recipient.
     */
    public static async processLocationForwarding(
        sock: WASocket,
        msg: WAMessage,
        senderRaw: string,
        chatJid: string,
        text: string
    ): Promise<boolean> {
        const cleanSender = cleanId(senderRaw) || senderRaw;
        const session = this.findSession(cleanSender, chatJid);
        if (!session) return false;

        const unwrapped =
            msg.message?.viewOnceMessage?.message ||
            msg.message?.viewOnceMessageV2?.message ||
            msg.message?.viewOnceMessageV2Extension?.message ||
            msg.message;

        const locMsg = unwrapped?.locationMessage || unwrapped?.liveLocationMessage;
        const contextInfo = unwrapped?.extendedTextMessage?.contextInfo || unwrapped?.locationMessage?.contextInfo;
        const quotedLoc =
            contextInfo?.quotedMessage?.locationMessage || contextInfo?.quotedMessage?.liveLocationMessage;

        const targetLocation = locMsg || quotedLoc;
        const trimmedText = text.trim().toLowerCase();
        const isSharelocText = trimmedText.startsWith('shareloc') || trimmedText.startsWith('.shareloc');

        if (!targetLocation && !isSharelocText) {
            return false;
        }

        if (!targetLocation) {
            await sock.sendMessage(
                chatJid,
                {
                    text: `📍 Please share the WhatsApp location directly or quote a location message with 'shareloc' to forward it to ${session.targetAlias}.`
                },
                { quoted: msg }
            );
            return true;
        }

        const lat = targetLocation.degreesLatitude;
        const lon = targetLocation.degreesLongitude;

        if (typeof lat !== 'number' || typeof lon !== 'number') {
            return false;
        }

        // Detokenize the recipient JID in server RAM
        const realJid = EphemeralTokenStore.resolveToken(session.targetToken, session.userJid, 'send_location');

        if (!realJid) {
            await sock.sendMessage(
                chatJid,
                {
                    text: `❌ Recipient token for ${session.targetAlias} has expired. Please re-initiate your request with *.sara*.`
                },
                { quoted: msg }
            );
            const key = this.getLookupKey(session.userJid, session.chatJid);
            activeLocationSessions.delete(key);
            unregisterCancellableSession(session.sessionId);
            return true;
        }

        // Clean up session before forwarding
        const key = this.getLookupKey(session.userJid, session.chatJid);
        activeLocationSessions.delete(key);
        unregisterCancellableSession(session.sessionId);

        try {
            await sock.sendPresenceUpdate('composing', realJid);
            await sock.sendMessage(realJid, {
                location: {
                    degreesLatitude: lat,
                    degreesLongitude: lon,
                    name:
                        'name' in targetLocation && typeof targetLocation.name === 'string'
                            ? targetLocation.name
                            : undefined,
                    address:
                        'address' in targetLocation && typeof targetLocation.address === 'string'
                            ? targetLocation.address
                            : undefined
                }
            });
            const rawOwnerName =
                session.subBotOwnerName && session.subBotOwnerName !== 'Owner' ? session.subBotOwnerName : 'Razael';
            const cleanSenderName = rawOwnerName.replace(/^(Ir\.|Dr\.|Drs\.|Prof\.)\s*/i, '').trim() || rawOwnerName;
            const attributionCaption = `${cleanSenderName} sent this from a different number — Sara AI`;
            await sock.sendMessage(realJid, { text: attributionCaption });
            // Confirm back to sender
            await sock.sendMessage(
                chatJid,
                {
                    text: `I've sent the location to ${session.targetAlias} with the note: "${attributionCaption}".`
                },
                { quoted: msg }
            );
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[AgentLocationStager] Failed to forward location to ${realJid}:`, err);
            await sock.sendMessage(chatJid, { text: `❌ Failed to forward location: ${errorMsg}` }, { quoted: msg });
        }

        return true;
    }

    public static clearAll(): void {
        activeLocationSessions.clear();
    }
}
