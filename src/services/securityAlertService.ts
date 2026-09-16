import { activeConnections } from '#utils/connectionManager.js';

export interface LoginAlertPayload {
    userJid: string;
    ipAddress: string;
    country?: string | null;
    userAgent?: string | null;
    deviceType?: string | null;
    isNewDevice: boolean;
}

/** Dispatches a real-time WhatsApp security push notification for a new or unrecognized login. */
export async function dispatchLoginSecurityAlert(payload: LoginAlertPayload): Promise<void> {
    const message =
        `🔐 *Cosmos Security Alert*\n\n` +
        `A login to your Cosmos web account was just detected.\n\n` +
        `• IP Address: ${payload.ipAddress}\n` +
        `• Country: ${payload.country || 'Unknown'}\n` +
        `• Device: ${payload.deviceType || 'Unknown device'}\n` +
        `• Browser: ${payload.userAgent ? payload.userAgent.slice(0, 80) : 'Unknown'}\n` +
        `• Status: ${payload.isNewDevice ? 'NEW DEVICE (untrusted)' : 'Recognized device'}\n\n` +
        `If this was not you, please change your password immediately and contact support.`;
    try {
        const sock = activeConnections.get('default');
        if (!sock) {
            console.log('[SecurityAlert] Default socket unavailable, skipping WhatsApp push alert.');
            return;
        }
        await sock.sendMessage(payload.userJid, { text: message });
        console.log(`[SecurityAlert] Login alert dispatched to ${payload.userJid}`);
    } catch (err) {
        console.error('[SecurityAlert] Failed to dispatch login security alert:', err);
    }
}
