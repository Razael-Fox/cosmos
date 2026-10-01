import { prisma } from '#db.js';
import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import toolsHandler from '#tools/handler.js';
import { getTranslator, getChatLanguage } from '#utils/i18n.js';

const autoDlCache = new Map<string, Map<string, boolean>>();

class ChatQueue {
    private queue: (() => Promise<void>)[] = [];
    private running = 0;
    private maxConcurrency = 2; // Prevent process crashes by limiting simultaneous DLs per chat

    async add(task: () => Promise<void>) {
        this.queue.push(task);
        this.runNext();
    }

    private async runNext() {
        if (this.running >= this.maxConcurrency || this.queue.length === 0) {
            return;
        }

        this.running++;
        const task = this.queue.shift();
        if (task) {
            try {
                await task();
            } finally {
                this.running--;
                this.runNext();
            }
        }
    }
}

const chatQueues = new Map<string, ChatQueue>();

function getChatQueue(jid: string): ChatQueue {
    let queue = chatQueues.get(jid);
    if (!queue) {
        queue = new ChatQueue();
        chatQueues.set(jid, queue);
    }
    return queue;
}

export async function loadAutoDlSettings() {
    try {
        const settings = await prisma.autoDlSetting.findMany();
        for (const setting of settings) {
            let jidMap = autoDlCache.get(setting.jid);
            if (!jidMap) {
                jidMap = new Map<string, boolean>();
                autoDlCache.set(setting.jid, jidMap);
            }
            jidMap.set(setting.platform, setting.enabled);
        }
        console.log('[AutoDl] Settings loaded from DB');
    } catch (error) {
        console.error('[AutoDl] Failed to load settings', error);
    }
}

export function isAutoDlEnabled(jid: string, platform: string): boolean {
    const jidMap = autoDlCache.get(jid);
    if (!jidMap) return false;
    return !!jidMap.get(platform);
}

export async function setAutoDl(jid: string, platform: string, enabled: boolean): Promise<boolean> {
    try {
        await prisma.autoDlSetting.upsert({
            where: {
                jid_platform: {
                    jid,
                    platform
                }
            },
            update: { enabled },
            create: { jid, platform, enabled }
        });

        let jidMap = autoDlCache.get(jid);
        if (!jidMap) {
            jidMap = new Map<string, boolean>();
            autoDlCache.set(jid, jidMap);
        }
        jidMap.set(platform, enabled);
        return true;
    } catch (error) {
        console.error('[AutoDl] Failed to set auto dl', error);
        return false;
    }
}

export async function processAutoDl(sock: WASocket, msg: WAMessage, jid: string, text: string) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex);
    if (!matches) return;

    // Deduplicate and sanitize trailing punctuation
    const rawUrls = matches.map((url) => url.replace(/[.,!?)>"']+$/, ''));
    const uniqueUrls = [...new Set(rawUrls)];

    for (const url of uniqueUrls) {
        let platform = '';
        let toolName = '';

        let host: string;
        try {
            host = new URL(url).hostname.toLowerCase();
        } catch {
            continue; // Invalid URL
        }

        if (host.includes('tiktok.com')) {
            platform = 'tiktok';
            toolName = 'tiktokdl';
        } else if (host.includes('instagram.com') || host.includes('instagr.am')) {
            platform = 'ig';
            toolName = 'ytdl'; // Since ytdl uses yt-dlp which supports IG
        } else if (host.includes('pin.it') || host.includes('pinterest.com')) {
            platform = 'pin';
            toolName = 'pinterestdl';
        } else if (host.includes('youtube.com') || host.includes('youtu.be')) {
            platform = 'yt';
            toolName = 'ytdl';
        } else if (host.includes('twitter.com') || host.includes('x.com') || host.includes('t.co')) {
            platform = 'twitter';
            toolName = 'ytdl';
        } else if (host.includes('facebook.com') || host.includes('fb.watch') || host.includes('fb.gg')) {
            platform = 'fb';
            toolName = 'ytdl';
        } else if (host.includes('threads.net')) {
            platform = 'threads';
            toolName = 'ytdl';
        }
        // NOTE: Telegram (`t.me`) auto-download is intentionally absent. The `tg` /
        // `telegram` platform keys remain in VALID_PLATFORMS so legacy AutoDLSetting
        // rows keep validating, but no user-facing Telegram tool is dispatched.

        if (platform && isAutoDlEnabled(jid, platform)) {
            const queue = getChatQueue(jid);

            queue.add(async () => {
                console.log(`[AutoDl] Triggered for platform ${platform} with URL ${url}`);
                try {
                    // Send reaction indicator to let user know it's queued
                    await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

                    // We ensure it executes only if the tool exists, otherwise we wait for phase 2.
                    // This handles gracefully if Phase 2 tools are not yet implemented.
                    if (toolsHandler.getTool(toolName)) {
                        const chatLang = await getChatLanguage(jid);
                        const t = getTranslator(chatLang);
                        // Automatic variation: no custom flags are forwarded, so each
                        // downloader resolves its own natural payload (TikTok video +
                        // soundtrack, YouTube video-only stream, Pinterest auto-detect).
                        const autoArgs: Record<string, any> = { url };
                        if (toolName === 'ytdl') {
                            autoArgs.quality = 'best';
                        }
                        const result = await toolsHandler.execute(toolName, autoArgs, {
                            sock,
                            msg,
                            jid,
                            t
                        });
                        if (result && typeof result === 'string' && result.trim().length > 0) {
                            await sock.sendMessage(jid, { text: result }, { quoted: msg });
                            await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
                        } else {
                            await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });
                        }
                        const { deleteSenderLink } = await import('./autoDelete.js');
                        await deleteSenderLink(sock, jid, msg.key);
                    } else {
                        console.warn(`[AutoDl] Tool ${toolName} not implemented yet.`);
                    }
                } catch (err) {
                    console.error(`[AutoDl] Error executing ${toolName}:`, err);
                    await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
                }
            });
        }
    }
}
