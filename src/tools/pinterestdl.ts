import { ToolDefinition, ToolContext } from './types.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import axios from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpeg from 'ffmpeg-static';
import { renderCard } from '../utils/uiFormatter.js';
import { parsePinterestArgs } from '../utils/downloaderArgs.js';

const execFileAsync = promisify(execFile);

const TEMP_MEDIA_DIR = path.join(os.tmpdir(), 'waf-pinterest');

/** Upper bound on carousel items delivered per pin to avoid flooding the chat. */
const MAX_PIN_ITEMS = 10;

/** Media classes reported on the info card. */
type PinterestMediaClass = 'photo' | 'video' | 'gif' | 'album';

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

/** A single de-duplicated media asset resolved from a pin page. */
interface PinAsset {
    url: string;
    kind: 'image' | 'video' | 'gif';
}

export const definition: ToolDefinition = {
    name: 'pinterestdl',
    displayNames: { en: 'pinterest dl', id: 'pinterest unduh' },
    title: 'Pinterest Downloader',
    category: 'Downloaders',
    aliases: ['.pinterest', '.pin', '.pindl', 'pinterest dl', '.pinterest dl', 'pin dl', '.pin dl'],
    description:
        'Downloads a Pinterest pin. Photos, videos, and animated GIFs are detected automatically and multi-photo pins are delivered as a native WhatsApp album. Append --audio to also extract the soundtrack.',
    descriptionKey: 'tools.commands.pinterestdl.description',
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The Pinterest pin URL (pin.it or pinterest.com), optionally followed by the --audio flag.'
            }
        },
        required: ['url']
    }
};

/** Renders a formal rejection card for an unusable request. */
function buildRejectionCard(ctx: ToolContext, message: string, hints: string[] = []): string {
    return renderCard({
        title: ctx.t('media.downloaders.error_title'),
        icon: '⚠️',
        headerStyle: 'light',
        body: [message, ...hints]
    });
}

/** Maps an asset URL to its media class for captioning. */
function classifyAssets(assets: PinAsset[]): PinterestMediaClass {
    if (assets.length > 1) return 'album';
    const single = assets[0];
    if (single.kind === 'gif') return 'gif';
    if (single.kind === 'video') return 'video';
    return 'photo';
}

const MEDIA_CLASS_VALUES: Record<PinterestMediaClass, string> = {
    photo: 'media.pinterestdl.value_photo',
    video: 'media.pinterestdl.value_video',
    gif: 'media.pinterestdl.value_gif',
    album: 'media.pinterestdl.value_album'
};

/** Builds the info card attached to the first delivered asset. */
function buildMediaCard(ctx: ToolContext, title: string, mediaClass: PinterestMediaClass, notes: string[]): string {
    const items: Array<{ label: string; value: string }> = [];
    if (title) items.push({ label: ctx.t('tools.downloader.title_label'), value: title.substring(0, 900) });
    items.push({
        label: ctx.t('media.ytdl.label_type'),
        value: ctx.t(MEDIA_CLASS_VALUES[mediaClass])
    });
    for (const note of notes) {
        items.push({ label: ctx.t('media.tiktokdl.label_note'), value: note });
    }

    return renderCard({
        title: ctx.t('media.pinterestdl.card_title'),
        icon: '📌',
        headerStyle: 'light',
        t: ctx.t,
        sections: [{ items }]
    });
}

/**
 * Streams a remote asset to disk. FFmpeg runs against the resulting file path, so
 * the buffer is always flushed to the temporary directory first.
 */
async function downloadFile(url: string, filepath: string): Promise<string> {
    const writer = fs.createWriteStream(filepath);
    const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 30000 });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(filepath));
        writer.on('error', reject);
    });
}

/** Determines the on-disk extension for an asset URL. */
function resolveExtension(url: string): { ext: string; kind: PinAsset['kind'] } {
    let pathname = '';
    try {
        pathname = new URL(url).pathname;
    } catch {
        /* fall through to the string check below */
    }
    const haystack = `${pathname}${url}`.toLowerCase();
    if (haystack.includes('.mp4') || haystack.includes('.m4v')) return { ext: '.mp4', kind: 'video' };
    if (haystack.includes('.gif')) return { ext: '.gif', kind: 'gif' };
    const match = pathname.match(/\.(jpg|jpeg|png|webp)$/i);
    if (match) return { ext: `.${match[1].toLowerCase()}`, kind: 'image' };
    if (haystack.includes('.png')) return { ext: '.png', kind: 'image' };
    if (haystack.includes('.webp')) return { ext: '.webp', kind: 'image' };
    return { ext: '.jpg', kind: 'image' };
}

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const senderJid = ctx.msg.key.participant || ctx.msg.key.remoteJid;
    const replyOptions = { quoted: ctx.msg };

    let rawInput: string = typeof args.url === 'string' ? args.url : '';
    if (!rawInput.trim()) {
        const quotedMsg = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg) {
            const extText = quotedMsg.extendedTextMessage;
            rawInput =
                quotedMsg.conversation ||
                extText?.text ||
                extText?.matchedText ||
                quotedMsg.videoMessage?.caption ||
                quotedMsg.imageMessage?.caption ||
                '';
        }
    }

    const parsed = parsePinterestArgs(rawInput);

    if (parsed.unknownFlags.length > 0) {
        console.error(`[PinterestDL Tool] Rejected unknown flags: ${parsed.unknownFlags.join(', ')}`);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return buildRejectionCard(
            ctx,
            ctx.t(parsed.unknownFlagsKey!, { flags: parsed.unknownFlags.map((f) => `--${f}`).join(', ') }),
            [ctx.t('media.downloaders.hint_pinterest_flags')]
        );
    }

    if (!parsed.url) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return buildRejectionCard(ctx, ctx.t('media.pinterestdl.invalid_url'), [
            ctx.t('media.downloaders.usage_pinterest')
        ]);
    }

    await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: ctx.msg.key } });

    const createdFiles: string[] = [];
    const tempDir = ensureTempMediaDir();
    const timestamp = Date.now();

    try {
        let targetUrl = parsed.url;
        if (targetUrl.includes('pin.it')) {
            try {
                const resRedirect = await fetch(targetUrl, {
                    redirect: 'follow',
                    signal: AbortSignal.timeout(10000)
                });
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

            const findMedia = (obj: any) => {
                if (typeof obj === 'string') {
                    if (obj.includes('.mp4')) {
                        media.videos.add(obj.replace(/\\/g, ''));
                    } else if (obj.match(/\.(jpg|png|jpeg)$/i) && obj.includes('/originals/')) {
                        media.images.add(obj.replace(/\\/g, ''));
                    }
                } else if (Array.isArray(obj)) {
                    obj.forEach(findMedia);
                } else if (obj !== null && typeof obj === 'object') {
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
            };
            findMedia(mainPinData);
        } else {
            const dataMatch = html.match(/<script id="__PWS_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
            if (dataMatch) {
                const data = JSON.parse(dataMatch[1]);

                let rootData = data;
                if (targetPinId && data?.props?.initialReduxState?.pins?.[targetPinId]) {
                    rootData = data.props.initialReduxState.pins[targetPinId];
                }
                const hasVideo = !!rootData.videos || !!rootData.story_pin_data || rootData.is_video;

                const findMediaFallback = (obj: any) => {
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
                };
                findMediaFallback(rootData);
            }
        }

        const rawMediaUrls = [...Array.from(media.videos), ...Array.from(media.images)];

        // Collapse per-asset rendition variants down to a single best URL per asset.
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

            if (!mediaGroups.has(mediaId)) mediaGroups.set(mediaId, []);
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

        const allMediaUrls = dedupedUrls.slice(0, MAX_PIN_ITEMS);

        if (allMediaUrls.length === 0) {
            console.error('[PinterestDL Tool] No media found on the page.');
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return buildRejectionCard(ctx, ctx.t('media.downloaders.error_no_media'), [
                ctx.t('media.downloaders.usage_pinterest')
            ]);
        }

        const assets: PinAsset[] = allMediaUrls.map((url) => ({ url, kind: resolveExtension(url).kind }));
        const mediaClass = classifyAssets(assets);
        const notes: string[] = [];
        if (dedupedUrls.length > MAX_PIN_ITEMS) {
            notes.push(ctx.t('media.downloaders.note_carousel_truncated', { count: String(MAX_PIN_ITEMS) }));
        }
        // Requesting audio from a still image cannot be satisfied.
        if (parsed.wantsAudio && mediaClass === 'photo') {
            notes.push(ctx.t('media.pinterestdl.note_no_audio_on_photo'));
        }
        if (parsed.wantsAudio && mediaClass === 'album' && assets.every((a) => a.kind === 'image')) {
            notes.push(ctx.t('media.pinterestdl.note_no_audio_on_photo'));
        }

        const caption = buildMediaCard(ctx, media.title, mediaClass, notes);
        const forwardContext = { isForwarded: true, forwardingScore: 1 };

        // Assets are dispatched back-to-back with no delay and no interleaved text,
        // which is what makes WhatsApp group them into one native album card.
        let isFirst = true;
        const extractedAudioPaths: string[] = [];

        for (let i = 0; i < allMediaUrls.length; i++) {
            const url = allMediaUrls[i];
            const { ext } = resolveExtension(url);
            const filepath = path.join(tempDir, `pinterest_${timestamp}_${i}${ext}`);
            await downloadFile(url, filepath);
            createdFiles.push(filepath);

            const mediaCaption = isFirst ? caption : undefined;
            let sentMsg: unknown;

            if (ext === '.mp4') {
                sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        video: { url: filepath },
                        mimetype: 'video/mp4',
                        caption: mediaCaption,
                        mentions: senderJid ? [senderJid] : undefined,
                        contextInfo: forwardContext
                    },
                    replyOptions
                );
            } else if (ext === '.gif') {
                sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        video: { url: filepath },
                        mimetype: 'video/mp4',
                        caption: mediaCaption,
                        mentions: senderJid ? [senderJid] : undefined,
                        contextInfo: forwardContext
                    },
                    replyOptions
                );
            } else {
                sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        image: { url: filepath },
                        caption: mediaCaption,
                        mentions: senderJid ? [senderJid] : undefined,
                        contextInfo: forwardContext
                    },
                    replyOptions
                );
            }

            if (sentMsg) {
                const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                scheduleMediaAutoDelete(
                    ctx.sock,
                    ctx.jid,
                    sentMsg as never,
                    ext === '.mp4' || ext === '.gif' ? 'video' : 'image'
                );
            }

            // Audio extraction is opt-in: sending a second message per video used to
            // clutter chats for users who never asked for it. Restricted to MP4
            // videos: animated GIFs carry no audio track, so `-map a` would only
            // produce a noisy failed ffmpeg call.
            if (parsed.wantsAudio && ext === '.mp4') {
                const audioOut = path.join(tempDir, `pinterest_${timestamp}_${i}_audio.mp3`);
                try {
                    // execFile with discrete argv keeps paths out of a shell, and
                    // avoids the `""/path/ffmpeg""` quoting bug that silently
                    // prevented extraction.
                    const bin = (ffmpeg as unknown as string) || 'ffmpeg';
                    await execFileAsync(bin, ['-i', filepath, '-q:a', '0', '-map', 'a', audioOut, '-y']);
                    if (fs.existsSync(audioOut)) extractedAudioPaths.push(audioOut);
                } catch (e) {
                    console.error('[PinterestDL Tool] Audio extraction failed:', e);
                }
            }

            isFirst = false;
        }

        for (const audioPath of extractedAudioPaths) {
            createdFiles.push(audioPath);
            try {
                const sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        audio: { url: audioPath },
                        mimetype: 'audio/mpeg',
                        mentions: senderJid ? [senderJid] : undefined,
                        contextInfo: forwardContext
                    },
                    replyOptions
                );
                if (sentMsg) {
                    const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                    scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg as never, 'audio');
                }
            } catch (e) {
                console.error('[PinterestDL Tool] Failed to deliver extracted audio:', e);
            }
        }

        if (parsed.wantsAudio && extractedAudioPaths.length === 0 && mediaClass !== 'photo' && mediaClass !== 'album') {
            await ctx.sock.sendMessage(
                ctx.jid,
                { text: ctx.t('media.pinterestdl.note_no_audio_stream') },
                replyOptions
            );
        }

        await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
        return;
    } catch (error: unknown) {
        console.error('[PinterestDL Tool] Execution error:', error);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    } finally {
        for (const file of createdFiles) safeUnlink(file);
    }
}
