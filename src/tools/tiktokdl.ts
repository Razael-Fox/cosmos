import { ToolDefinition, ToolContext } from './types.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import axios from 'axios';
import { renderCard } from '../utils/uiFormatter.js';
import { ParsedTikTokArgs, parseTikTokArgs, validateTikTokContentMatch } from '../utils/downloaderArgs.js';

/** Transient directory for TikTok downloads; files are removed after delivery. */
const TEMP_MEDIA_DIR = path.join(os.tmpdir(), 'waf-tiktok');

/** Maximum number of carousel images delivered in a single album. */
const MAX_CAROUSEL_IMAGES = 35;

function ensureTempMediaDir(): string {
    if (!fs.existsSync(TEMP_MEDIA_DIR)) {
        fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
    }
    return TEMP_MEDIA_DIR;
}

/** Safely removes a temporary file, ignoring missing-path errors. */
function safeUnlink(filePath: string | null | undefined): void {
    if (!filePath) return;
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
        console.error(`[TikTokDL Tool] Failed to remove temporary file ${filePath}:`, err);
    }
}

const AUDIO_MIME_TYPES: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.wav': 'audio/wav'
};

/** Media classes reported on the info card so users can see what was delivered. */
type MediaClass = 'video' | 'audio' | 'photo' | 'album';

const MEDIA_CLASS_KEYS: Record<MediaClass, { label: string; value: string }> = {
    video: { label: 'media.tiktokdl.label_type', value: 'media.tiktokdl.value_video' },
    audio: { label: 'media.tiktokdl.label_type', value: 'media.tiktokdl.value_audio' },
    photo: { label: 'media.tiktokdl.label_type', value: 'media.tiktokdl.value_photo' },
    album: { label: 'media.tiktokdl.label_type', value: 'media.tiktokdl.value_album' }
};

/**
 * Streams a remote media asset to disk.
 * @param ffmpegWriteBufferGuard Buffer-based sources must already be flushed to disk
 *   before FFmpeg runs; this helper writes the stream straight to a file path.
 */
async function downloadFile(url: string, ext: string, filepath: string): Promise<string> {
    const writer = fs.createWriteStream(filepath);
    const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 30000 });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(filepath));
        writer.on('error', reject);
    });
}

export const definition: ToolDefinition = {
    name: 'tiktokdl',
    displayNames: { en: 'tiktok dl', id: 'tiktok unduh' },
    title: 'TikTok Downloader',
    category: 'Downloaders',
    aliases: ['.tiktok', '.tt', '.tiktokdl', '.ttdl', 'tiktok dl', 'tt dl', '.tiktok dl', '.tt dl'],
    description:
        'Downloads TikTok media. Without flags it delivers the natural payload for the post plus its original soundtrack. Use --audio, --video, --photo, or --multi-photo to select exactly what you need.',
    descriptionKey: 'tools.commands.tiktokdl.description',
    limitKey: 'download',
    limit: { max: 3, windowMs: 600_000 },
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description:
                    'The TikTok post URL, optionally followed by flags: --audio, --video, --photo, or --multi-photo.'
            }
        },
        required: ['url']
    }
};

/** Renders the structured media information card shown on the first delivered asset. */
function buildMediaCard(
    ctx: ToolContext,
    data: { title?: string; author?: string; duration?: number },
    mediaClass: MediaClass,
    notes: string[] = []
): string {
    const items: Array<{ label: string; value: string }> = [];

    let title = (data.title || '').trim();
    if (title.length > 900) title = `${title.substring(0, 900)}...`;
    if (title) items.push({ label: ctx.t('media.tiktokdl.label_title'), value: title });
    if (data.author) items.push({ label: ctx.t('media.tiktokdl.label_author'), value: String(data.author) });
    if (data.duration)
        items.push({
            label: ctx.t('media.tiktokdl.label_duration'),
            value: `${data.duration}s`
        });

    items.push({
        label: ctx.t(MEDIA_CLASS_KEYS[mediaClass].label),
        value: ctx.t(MEDIA_CLASS_KEYS[mediaClass].value)
    });

    for (const note of notes) {
        items.push({ label: ctx.t('media.tiktokdl.label_note'), value: note });
    }

    if (items.length === 0) {
        items.push({
            label: ctx.t('media.tiktokdl.label_status'),
            value: ctx.t('media.tiktokdl.value_ready')
        });
    }

    return renderCard({
        title: ctx.t('media.tiktokdl.card_title'),
        icon: '🎬',
        headerStyle: 'light',
        sections: [{ items }]
    });
}

/** Renders a formal rejection card for an unusable parameter combination. */
function buildRejectionCard(ctx: ToolContext, message: string, hints: string[] = []): string {
    return renderCard({
        title: ctx.t('media.downloaders.error_title'),
        icon: '⚠️',
        headerStyle: 'light',
        body: [message, ...hints]
    });
}

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const senderJid = ctx.msg.key.participant || ctx.msg.key.remoteJid;
    const replyOptions = { quoted: ctx.msg };

    // The message handler assigns the entire argument string to the single declared
    // parameter, so `args.url` still carries any trailing flags. Fall back to the
    // quoted message when the user replies to a link instead of typing it.
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

    const parsed: ParsedTikTokArgs = parseTikTokArgs(rawInput);

    if (parsed.unknownFlags.length > 0) {
        console.error(`[TikTokDL Tool] Rejected unknown flags: ${parsed.unknownFlags.join(', ')}`);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return buildRejectionCard(
            ctx,
            ctx.t(parsed.unknownFlagsKey!, { flags: parsed.unknownFlags.map((f) => `--${f}`).join(', ') }),
            [ctx.t('media.downloaders.hint_tiktok_flags')]
        );
    }

    if (parsed.conflict) {
        console.error(`[TikTokDL Tool] Rejected conflicting flags: ${parsed.conflict}`);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return buildRejectionCard(ctx, ctx.t(parsed.conflictKey!), [ctx.t('media.downloaders.hint_tiktok_flags')]);
    }

    if (!parsed.url) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return buildRejectionCard(ctx, ctx.t('media.tiktokdl.invalid_url'), [ctx.t('media.downloaders.usage_tiktok')]);
    }

    await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: ctx.msg.key } });

    let targetUrl = parsed.url;
    if (targetUrl.includes('vt.tiktok.com') || targetUrl.includes('vm.tiktok.com')) {
        try {
            const res = await fetch(targetUrl, {
                redirect: 'follow',
                signal: AbortSignal.timeout(10000)
            });
            targetUrl = res.url;
        } catch (e) {
            console.error('[TikTokDL Tool] Failed to resolve shortlink:', e);
        }
    }
    targetUrl = targetUrl.replace(/\/photo\//g, '/video/');

    const tempDir = ensureTempMediaDir();
    const timestamp = Date.now();
    const createdFiles: string[] = [];

    try {
        const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}`;
        const res = await axios.get(apiUrl, { timeout: 15000 });
        if (res.data.code !== 0 || !res.data.data) {
            const apiMessage = res.data.msg || ctx.t('media.tiktokdl.unknown_error');
            throw new Error(ctx.t('media.tiktokdl.api_error', { message: apiMessage }));
        }

        const data = res.data.data;
        const images: string[] = Array.isArray(data.images)
            ? data.images.filter((img: unknown): img is string => typeof img === 'string' && img.length > 0)
            : [];
        const videoUrl: string | null = typeof data.play === 'string' && data.play ? data.play : null;
        const musicUrl: string | null = typeof data.music === 'string' && data.music ? data.music : null;

        // ── Content validation ────────────────────────────────────────────────
        const mismatchKey = validateTikTokContentMatch({
            wantsVideo: parsed.wantsVideo,
            wantsPhoto: parsed.wantsPhoto,
            wantsMultiPhoto: parsed.wantsMultiPhoto,
            hasVideo: Boolean(videoUrl),
            photoCount: images.length
        });
        if (mismatchKey) {
            console.error(`[TikTokDL Tool] Content mismatch rejected: ${mismatchKey}`);
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return buildRejectionCard(ctx, ctx.t(mismatchKey), [ctx.t('media.downloaders.hint_tiktok_flags')]);
        }

        // ── Delivery planning ─────────────────────────────────────────────────
        // Automatic mode mirrors the post's natural payload; custom mode delivers
        // strictly what was requested.
        const notes: string[] = [];
        let wantVideo = false;
        let wantPhotos: string[] = [];
        let wantAudio = false;

        if (parsed.isAutomatic) {
            if (images.length > 0) {
                wantPhotos = images.slice(0, MAX_CAROUSEL_IMAGES);
                if (images.length > MAX_CAROUSEL_IMAGES) {
                    notes.push(
                        ctx.t('media.downloaders.note_carousel_truncated', {
                            count: String(MAX_CAROUSEL_IMAGES)
                        })
                    );
                }
            } else if (videoUrl) {
                wantVideo = true;
            }
            wantAudio = true;
        } else {
            wantVideo = parsed.wantsVideo;
            wantAudio = parsed.wantsAudio;

            if (parsed.wantsMultiPhoto) {
                wantPhotos = images.slice(0, MAX_CAROUSEL_IMAGES);
                if (images.length > MAX_CAROUSEL_IMAGES) {
                    notes.push(
                        ctx.t('media.downloaders.note_carousel_truncated', {
                            count: String(MAX_CAROUSEL_IMAGES)
                        })
                    );
                }
            } else if (parsed.wantsPhoto) {
                // A carousel URL resolves to its primary (first) photo.
                wantPhotos = images.length > 0 ? [images[0]] : [];
                if (images.length > 1) {
                    notes.push(ctx.t('media.downloaders.note_single_photo_from_carousel'));
                }
            }
        }

        if (wantPhotos.length === 1 && parsed.wantsMultiPhoto) {
            // Graceful degradation: a single-photo post still satisfies --multi-photo.
            notes.push(ctx.t('media.downloaders.note_single_photo_album'));
        }

        if (!wantVideo && wantPhotos.length === 0 && !wantAudio) {
            console.error('[TikTokDL Tool] Nothing to deliver for the resolved parameters.');
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return buildRejectionCard(ctx, ctx.t('media.downloaders.error_no_media'), [
                ctx.t('media.downloaders.hint_tiktok_flags')
            ]);
        }

        const mediaClass: MediaClass = wantVideo
            ? 'video'
            : wantPhotos.length > 1
              ? 'album'
              : wantPhotos.length === 1
                ? 'photo'
                : 'audio';

        const schedule = async (sent: unknown, kind: 'video' | 'image' | 'audio') => {
            if (!sent) return;
            const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
            scheduleMediaAutoDelete(ctx.sock, ctx.jid, sent as never, kind);
        };

        const forwardContext = { isForwarded: true, forwardingScore: 1 };

        // ── Asset acquisition ─────────────────────────────────────────────────
        const videoPath =
            wantVideo && videoUrl
                ? await downloadFile(videoUrl, '.mp4', path.join(tempDir, `tiktok_${timestamp}_vid.mp4`))
                : null;
        if (videoPath) createdFiles.push(videoPath);

        const photoPaths: string[] = [];
        for (let i = 0; i < wantPhotos.length; i++) {
            const photoPath = await downloadFile(
                wantPhotos[i],
                '.jpg',
                path.join(tempDir, `tiktok_${timestamp}_img_${i}.jpg`)
            );
            photoPaths.push(photoPath);
            createdFiles.push(photoPath);
        }

        let audioPath: string | null = null;
        if (wantAudio && musicUrl) {
            try {
                audioPath = await downloadFile(musicUrl, '.mp3', path.join(tempDir, `tiktok_${timestamp}_audio.mp3`));
                createdFiles.push(audioPath);
            } catch (e) {
                console.error('[TikTokDL Tool] Music download failed:', e);
            }
        }

        if (wantAudio && !audioPath) {
            notes.push(ctx.t('media.downloaders.note_no_audio_available'));
        }

        // The card is built only now, after asset acquisition, so every note
        // (including "no soundtrack available") actually reaches the caption.
        const caption = buildMediaCard(
            ctx,
            { title: data.title, author: data.author?.nickname, duration: data.duration },
            mediaClass,
            notes
        );

        // ── Dispatch ──────────────────────────────────────────────────────────
        // Images are dispatched back-to-back with no interleaved text so WhatsApp
        // groups them into a single native album card.
        let isFirst = true;
        const sendWithCaption = (mediaCaption: string | undefined) => (isFirst ? mediaCaption : undefined);

        if (videoPath) {
            const sent = await ctx.sock.sendMessage(
                ctx.jid,
                {
                    video: { url: videoPath },
                    mimetype: 'video/mp4',
                    caption: sendWithCaption(caption),
                    mentions: senderJid ? [senderJid] : undefined,
                    contextInfo: forwardContext
                },
                replyOptions
            );
            await schedule(sent, 'video');
            isFirst = false;
        }

        for (const photoPath of photoPaths) {
            const sent = await ctx.sock.sendMessage(
                ctx.jid,
                {
                    image: { url: photoPath },
                    caption: sendWithCaption(caption),
                    mentions: senderJid ? [senderJid] : undefined,
                    contextInfo: forwardContext
                },
                replyOptions
            );
            await schedule(sent, 'image');
            isFirst = false;
        }

        if (audioPath) {
            const sent = await ctx.sock.sendMessage(
                ctx.jid,
                {
                    audio: { url: audioPath },
                    mimetype: AUDIO_MIME_TYPES[path.extname(audioPath).toLowerCase()] || 'audio/mpeg',
                    caption: sendWithCaption(caption),
                    mentions: senderJid ? [senderJid] : undefined,
                    contextInfo: forwardContext
                },
                replyOptions
            );
            await schedule(sent, 'audio');
            isFirst = false;
        }

        if (isFirst) {
            // Every requested asset failed to download.
            console.error('[TikTokDL Tool] No asset could be delivered.');
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return buildRejectionCard(ctx, ctx.t('media.downloaders.error_no_media'), [
                ctx.t('media.downloaders.hint_tiktok_flags')
            ]);
        }

        await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
        return;
    } catch (error: unknown) {
        console.error('[TikTokDL Tool] Execution error:', error);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    } finally {
        // Guarantee no temporary artifacts survive the request, even on failure.
        for (const file of createdFiles) safeUnlink(file);
    }
}
