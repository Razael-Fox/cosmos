/**
 * WhatsApp status transport.
 *
 * Sends plain-text notifications through the live Baileys socket to a configured
 * newsletter/channel JID, falling back to an owner direct message when the
 * channel send fails. It NEVER throws into the Baileys socket loop; failures are
 * surfaced as a `DeliveryResult` so the notifier can enqueue a retry.
 */
import { activeConnections } from '#utils/connectionManager.js';
import { getStatusNotifierConfig } from '../config.js';
import { formatWhatsAppText } from '../formatters.js';
import type { NotifyEvent, NotifyPayload, NotifySeverity, DeliveryResult } from '../types.js';

async function sendToJid(jid: string, text: string): Promise<void> {
    const sock = activeConnections.get('default');
    if (!sock) {
        throw new Error('default Baileys socket is not connected');
    }
    await sock.sendMessage(jid, { text });
}

export async function sendWhatsApp(
    event: NotifyEvent,
    severity: NotifySeverity,
    payload: NotifyPayload
): Promise<DeliveryResult> {
    const config = getStatusNotifierConfig();
    if (!config.whatsapp.enabled) {
        return { channel: 'whatsapp', success: false, skipped: true, error: 'whatsapp disabled or unconfigured' };
    }

    const text = formatWhatsAppText(event, severity, payload);

    // Primary: the configured channel/newsletter JID.
    if (config.whatsapp.newsletterJid) {
        try {
            await sendToJid(config.whatsapp.newsletterJid, text);
            console.log(`[StatusNotifier] WhatsApp channel delivered ${event}.`);
            return { channel: 'whatsapp', success: true, attempts: 1 };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[StatusNotifier] WhatsApp channel send failed (${message}); attempting owner DM fallback.`);
        }
    }

    // Fallback: owner direct message.
    if (config.whatsapp.fallbackToOwnerDm && config.whatsapp.ownerJid) {
        const ownerJid = config.whatsapp.ownerJid.includes('@')
            ? config.whatsapp.ownerJid
            : `${config.whatsapp.ownerJid.replace(/\D/g, '')}@s.whatsapp.net`;
        try {
            await sendToJid(ownerJid, text);
            console.log(`[StatusNotifier] WhatsApp owner-DM fallback delivered ${event}.`);
            return { channel: 'whatsapp', success: true, attempts: 1 };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[StatusNotifier] WhatsApp owner-DM fallback failed: ${message}`);
            return { channel: 'whatsapp', success: false, error: message, attempts: 1 };
        }
    }

    return { channel: 'whatsapp', success: false, error: 'no WhatsApp channel or owner fallback available' };
}
