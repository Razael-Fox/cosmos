/**
 * WhatsApp status transport.
 *
 * Sends plain-text notifications through the live Baileys socket to a configured
 * newsletter/channel JID, falling back to an owner direct message when the
 * channel send fails. It NEVER throws into the Baileys socket loop; failures are
 * surfaced as a `DeliveryResult` so the notifier can enqueue a retry.
 */
import { activeConnections } from '#utils/connectionManager.js';
import fs from 'fs';
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

/**
 * Sends a document artifact (e.g. the SQLite backup snapshot) through the live
 * Baileys socket to the configured channel, with owner-DM fallback. Never throws.
 */
export async function sendWhatsAppFile(filePath: string, fileName: string, caption: string): Promise<DeliveryResult> {
    const config = getStatusNotifierConfig();
    if (!config.whatsapp.enabled) {
        return { channel: 'whatsapp', success: false, skipped: true, error: 'whatsapp disabled or unconfigured' };
    }

    const sock = activeConnections.get('default');
    if (!sock) {
        return { channel: 'whatsapp', success: false, error: 'default Baileys socket is not connected', attempts: 1 };
    }

    let fileBuffer: Buffer;
    try {
        fileBuffer = fs.readFileSync(filePath);
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[StatusNotifier] WhatsApp backup artifact read failed: ${error}`);
        return { channel: 'whatsapp', success: false, error, attempts: 1 };
    }

    const document = {
        document: fileBuffer,
        fileName,
        mimetype: 'application/octet-stream',
        caption
    };

    const targets = [
        config.whatsapp.newsletterJid,
        config.whatsapp.fallbackToOwnerDm && config.whatsapp.ownerJid
            ? config.whatsapp.ownerJid.includes('@')
                ? config.whatsapp.ownerJid
                : `${config.whatsapp.ownerJid.replace(/\D/g, '')}@s.whatsapp.net`
            : null
    ].filter((jid): jid is string => !!jid);

    for (const jid of targets) {
        try {
            await sock.sendMessage(jid, document);
            console.log(`[StatusNotifier] WhatsApp delivered backup artifact (${fileName}).`);
            return { channel: 'whatsapp', success: true, attempts: 1 };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            console.warn(`[StatusNotifier] WhatsApp backup artifact send to ${jid.slice(0, 6)}… failed: ${error}`);
        }
    }

    return { channel: 'whatsapp', success: false, error: 'all WhatsApp targets failed', attempts: 1 };
}
