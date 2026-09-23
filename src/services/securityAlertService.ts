import { activeConnections } from '#utils/connectionManager.js';
import { getChatLanguage, getTranslator } from '#utils/i18n.js';
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
    const lang = await getChatLanguage(payload.userJid);
    const t = getTranslator(lang);
    const statusStr = payload.isNewDevice
        ? t('core.security_alert_status_new')
        : t('core.security_alert_status_recognized');
    const unknownStr = t('core.unknown');
    const unknownDevice = t('core.unknown_device');

    const message =
        `${t('core.security_alert_title')}\n\n` +
        `${t('core.security_alert_body')}\n\n` +
        `${t('core.security_alert_ip', { ip: payload.ipAddress })}\n` +
        `${t('core.security_alert_country', { country: payload.country || unknownStr })}\n` +
        `${t('core.security_alert_device', { device: payload.deviceType || unknownDevice })}\n` +
        `${t('core.security_alert_browser', { browser: payload.userAgent ? payload.userAgent.slice(0, 80) : unknownStr })}\n` +
        `${t('core.security_alert_status', { status: statusStr })}\n\n` +
        `${t('core.security_alert_remedy')}`;
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
