import { isSessionActive, activateSession, deactivateSession, toggleSession } from '#utils/sessionStore.js';

const FEATURE_NAME = 'autosticker';

export async function enableAutoSticker(jid: string): Promise<void> {
    await activateSession(FEATURE_NAME, jid);
}

export async function disableAutoSticker(jid: string): Promise<boolean> {
    return await deactivateSession(FEATURE_NAME, jid);
}

export async function toggleAutoSticker(jid: string): Promise<boolean> {
    return await toggleSession(FEATURE_NAME, jid);
}

export function isAutoStickerEnabled(jid: string): boolean {
    return isSessionActive(FEATURE_NAME, jid);
}
