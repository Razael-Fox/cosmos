import { ToolDefinition, ToolContext } from './types.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import ffmpeg from 'ffmpeg-static';
import { renderCard } from '../utils/uiFormatter.js';

const execAsync = promisify(exec);

const TEMP_MEDIA_DIR = path.join(os.tmpdir(), 'waf-pinterest');

function ensureTempMediaDir(): string {
    if (!fs.existsSync(TEMP_MEDIA_DIR)) {
        fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
    }
    return TEMP_MEDIA_DIR;
}

function safeUnlink(filePath: string | null | undefined): void {
    if (!filePath) return;
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
        console.error(`[PinterestDL Tool] Failed to remove temporary file ${filePath}:`, err);
    }
}

export const definition: ToolDefinition = {
    name: 'pinterestdl',
    title: 'Pinterest Downloader',
    category: 'Downloaders',
    aliases: ['.pinterest', '.pin', '.pindl'],
    description: 'Downloads a video, image, or carousel from a specified Pinterest URL.',
    descriptionKey: 'tools.commands.pinterestdl.description',
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL of the Pinterest post (pin.it or pinterest.com).'
            }
        },
        required: ['url']
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    let targetUrl = args.url;
    const senderJid = ctx.msg.key.participant || ctx.msg.key.remoteJid;

    if (!targetUrl || targetUrl.trim() === '') {
        const quotedMsg = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg) {
            const extText = quotedMsg.extendedTextMessage;
            targetUrl =
                quotedMsg.conversation ||
                extText?.text ||
                extText?.matchedText ||
                quotedMsg.videoMessage?.caption ||
                quotedMsg.imageMessage?.caption ||
                '';
        }
    }

    if (!targetUrl) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    }

    const urlRegex = /(https?:\/\/[^\s]+)/;
    const match = targetUrl.match(urlRegex);
    if (match) {
        targetUrl = match[1];
    } else {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    }

    await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: ctx.msg.key } });

    const downloadedFiles: string[] = [];
    const tempDir = ensureTempMediaDir();
    const timestamp = Date.now();

    try {
        // Resolve redirect for shortlinks like pin.it
        if (targetUrl.includes('pin.it')) {
            try {
                const resRedirect = await fetch(targetUrl, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
                targetUrl = resRedirect.url;
            } catch (e) {
                console.error('[PinterestDL Tool] Failed to resolve shortlink:', e);
            }
        }

        const res = await axios.get(targetUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });

        const html = res.data;
        const relayMatch = html.match(/window\.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__\([^,]+,\s*(\{.*?\})\);/);

        const media = { images: new Set<string>(), videos: new Set<string>(), title: '' };

        const pinIdMatch = targetUrl.match(/\/pin\/(\d+)/);
        const targetPinId = pinIdMatch ? pinIdMatch[1] : null;

        if (relayMatch) {
            const data = JSON.parse(relayMatch[1]);
            const mainPinData = data?.data?.v3GetPinQueryv2?.data || data;
            const hasVideo = !!mainPinData.videos || !!mainPinData.storyPinData || mainPinData.isVideo;

            function findMedia(obj: any) {
                if (typeof obj === 'string') {
                    if (obj.includes('.mp4')) {
                        media.videos.add(obj.replace(/\\/g, ''));
                    } else if (obj.match(/\.(jpg|png|jpeg)$/i) && obj.includes('/originals/')) {
                        media.images.add(obj.replace(/\\/g, ''));
                    }
                } else if (Array.isArray(obj)) {
                    obj.forEach(findMedia);
                } else if (obj !== null && typeof obj === 'object') {
                    // Prevent traversing into unrelated pins or recommendations
                    if (obj.__typename === 'Pin' && obj.id && mainPinData.id && obj.id !== mainPinData.id) return;
                    if (obj.seoTitle && typeof obj.seoTitle === 'string' && !media.title) media.title = obj.seoTitle;
                    if (obj.title && typeof obj.title === 'string' && !media.title) media.title = obj.title;

                    Object.keys(obj).forEach((k) => {
                        if (['relatedPins', 'recommendations', 'morePins'].includes(k)) return;
                        if (obj === mainPinData && hasVideo && (k.startsWith('images_') || k.startsWith('image')))
                            return;
                        findMedia(obj[k]);
                    });
                }
            }
            findMedia(mainPinData);
        } else {
            // Fallback for older PWS_DATA structure if Relay isn't found
            const dataMatch = html.match(/<script id="__PWS_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
            if (dataMatch) {
                const data = JSON.parse(dataMatch[1]);

                let rootData = data;
                if (targetPinId && data?.props?.initialReduxState?.pins?.[targetPinId]) {
                    rootData = data.props.initialReduxState.pins[targetPinId];
                }
                const hasVideo = !!rootData.videos || !!rootData.story_pin_data || rootData.is_video;

                function findMediaFallback(obj: any) {
                    if (typeof obj === 'string') {
                        if (obj.includes('.mp4')) {
                            media.videos.add(obj.replace(/\\/g, ''));
                        } else if (obj.match(/\.(jpg|png|jpeg)$/i) && obj.includes('/originals/')) {
                            media.images.add(obj.replace(/\\/g, ''));
                        }
                    } else if (Array.isArray(obj)) {
                        obj.forEach(findMediaFallback);
                    } else if (obj !== null && typeof obj === 'object') {
                        if (obj.title && typeof obj.title === 'string' && !media.title) media.title = obj.title;

                        Object.keys(obj).forEach((k) => {
                            if (['relatedPins', 'recommendations', 'morePins'].includes(k)) return;
                            if (obj === rootData && hasVideo && (k.startsWith('images_') || k.startsWith('image')))
                                return;
                            findMediaFallback(obj[k]);
                        });
                    }
                }
                findMediaFallback(rootData);
            }
        }

        const rawMediaUrls = [...Array.from(media.videos), ...Array.from(media.images)];

        const mediaGroups = new Map<string, string[]>();
        for (const url of rawMediaUrls) {
            let mediaId = 'unknown';
            try {
                const pathname = new URL(url).pathname;
                const match = pathname.match(/([a-f0-9]{24,})/i);
                mediaId = match ? match[1] : pathname.split('/').pop()?.split('.')[0] || 'unknown';
            } catch {
                // Ignore invalid URLs
            }
            if (mediaId.includes('_')) mediaId = mediaId.split('_')[0];

            if (!mediaGroups.has(mediaId)) {
                mediaGroups.set(mediaId, []);
            }
            mediaGroups.get(mediaId)!.push(url);
        }

        const dedupedUrls: string[] = [];
        for (const variants of mediaGroups.values()) {
            const videos = variants.filter((u) => u.includes('.mp4'));
            const images = variants.filter((u) => u.match(/\.(jpg|png|jpeg)$/i));

            if (videos.length > 0) {
                let bestVideo = videos[0];
                for (const v of videos) {
                    if (v.includes('720p') || v.includes('1080p') || v.includes('V_720P') || v.includes('V_ORIGINAL')) {
                        bestVideo = v;
                        break;
                    }
                }
                dedupedUrls.push(bestVideo);
            } else if (images.length > 0) {
                dedupedUrls.push(images[0]);
            }
        }

        // Limit to 10 items max to avoid spam
        const allMediaUrls = dedupedUrls.slice(0, 10);

        if (allMediaUrls.length === 0) {
            console.error('[PinterestDL Tool] No media found on the page.');
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return;
        }

        const downloadFile = async (url: string, ext: string, index: string | number = ''): Promise<string> => {
            const filepath = path.join(tempDir, `pinterest_${timestamp}_${index}${ext}`);
            const writer = fs.createWriteStream(filepath);
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                timeout: 20000
            });
            response.data.pipe(writer);
            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(filepath));
                writer.on('error', reject);
            });
        };

        const items: Array<{ label: string; value: string }> = [];
        if (media.title)
            items.push({ label: ctx.t('tools.downloader.title_label'), value: media.title.substring(0, 900) });
        const mediaType = media.videos.size > 0 ? ctx.t('media.ytdl.value_video') : ctx.t('media.ytdl.value_image');
        items.push({ label: ctx.t('media.ytdl.label_type'), value: mediaType });

        const caption = renderCard({
            title: ctx.t('media.pinterestdl.card_title'),
            icon: '📌',
            headerStyle: 'light',
            t: ctx.t,
            sections: [
                {
                    items
                }
            ]
        });

        // Download and send each item
        for (let i = 0; i < allMediaUrls.length; i++) {
            const url = allMediaUrls[i];
            const ext = url.includes('.mp4') ? '.mp4' : path.extname(new URL(url).pathname) || '.jpg';
            const filepath = await downloadFile(url, ext, i);
            downloadedFiles.push(filepath);

            const isVideo = ext === '.mp4';

            // Send as Media
            if (isVideo) {
                const sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        video: { url: filepath },
                        mimetype: 'video/mp4',
                        caption: caption,
                        mentions: senderJid ? [senderJid] : undefined,
                        contextInfo: { isForwarded: true, forwardingScore: 1 }
                    },
                    { quoted: ctx.msg }
                );
                if (sentMsg) {
                    const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                    scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg, 'video');
                }

                const audioOut = path.join(tempDir, `pinterest_${timestamp}_${i}_audio.mp3`);
                try {
                    const ffmpegCmd = ffmpeg ? `"${ffmpeg}"` : 'ffmpeg';
                    await execAsync(`${ffmpegCmd} -i "${filepath}" -q:a 0 -map a "${audioOut}" -y`);
                    if (fs.existsSync(audioOut)) {
                        downloadedFiles.push(audioOut);
                        const sentMsg2 = await ctx.sock.sendMessage(
                            ctx.jid,
                            {
                                audio: { url: audioOut },
                                mimetype: 'audio/mpeg',
                                mentions: senderJid ? [senderJid] : undefined,
                                contextInfo: { isForwarded: true, forwardingScore: 1 }
                            },
                            { quoted: ctx.msg }
                        );
                        if (sentMsg2) {
                            const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                            scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg2, 'audio');
                        }
                    }
                } catch (e) {
                    console.error('[PinterestDL Tool] Audio extraction failed:', e);
                }
            } else {
                const sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        image: { url: filepath },
                        caption: caption,
                        mentions: senderJid ? [senderJid] : undefined,
                        contextInfo: { isForwarded: true, forwardingScore: 1 }
                    },
                    { quoted: ctx.msg }
                );
                if (sentMsg) {
                    const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                    scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg, 'image');
                }
            }

            // Send as Document (requested by user)
            await ctx.sock.sendMessage(
                ctx.jid,
                {
                    document: { url: filepath },
                    mimetype: isVideo ? 'video/mp4' : 'image/jpeg',
                    fileName: `Pinterest_${timestamp}_${i}${ext}`,
                    caption: ctx.t ? ctx.t('media.pinterestdl.document_version') : 'Document version',
                    mentions: senderJid ? [senderJid] : undefined,
                    contextInfo: { isForwarded: true, forwardingScore: 1 }
                },
                { quoted: ctx.msg }
            );
        }

        await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
        return;
    } catch (error: any) {
        console.error('[PinterestDL Tool] Execution error:', error);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    } finally {
        for (const file of downloadedFiles) safeUnlink(file);
    }
}
