import { prisma } from '#db.js';

const nsfwCache = new Map<string, boolean>();

/**
 * Preloads all group NSFW settings from the database into in-memory cache during startup.
 */
export async function loadNsfwSettings(): Promise<void> {
    try {
        const settings = await prisma.groupNsfwSetting.findMany();
        for (const setting of settings) {
            nsfwCache.set(setting.jid, setting.enabled);
        }
        console.log(`[NSFW] Preloaded ${settings.length} group settings from database.`);
    } catch (error) {
        console.error('[NSFW] Failed to load NSFW settings from database:', error);
    }
}

/**
 * Checks if the NSFW feature is enabled for a given chat JID.
 * - Non-group chats (DMs / @s.whatsapp.net, @lid): Always enabled (true).
 * - Group chats (@g.us): Disabled by default unless explicitly enabled.
 */
export function isNsfwEnabled(jid: string): boolean {
    if (!jid.endsWith('@g.us')) {
        return true;
    }
    return nsfwCache.get(jid) ?? false;
}

/**
 * Updates the NSFW state for a group chat in both cache and persistent database.
 */
export async function setNsfwEnabled(jid: string, enabled: boolean, updatedBy?: string): Promise<void> {
    nsfwCache.set(jid, enabled);
    try {
        await prisma.groupNsfwSetting.upsert({
            where: { jid },
            update: {
                enabled,
                updatedBy: updatedBy ?? null,
                updatedAt: new Date()
            },
            create: {
                jid,
                enabled,
                updatedBy: updatedBy ?? null
            }
        });
    } catch (error) {
        console.error(`[NSFW] Failed to persist NSFW setting for group ${jid}:`, error);
        throw error;
    }
}
