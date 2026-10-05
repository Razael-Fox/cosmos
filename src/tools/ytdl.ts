import { ToolDefinition, ToolContext } from './types.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'ffmpeg-static';
import { renderCard } from '../utils/uiFormatter.js';
import {
    ParsedYouTubeArgs,
    YouTubeVideoQuality,
    buildYouTubeAudioArgv,
    buildYouTubeVideoFormat,
    describeAudioBitrate,
    describeVideoQuality,
    parseYouTubeArgs
} from '../utils/downloaderArgs.js';

/**
 * Runs yt-dlp with a discrete argv array.
 *
 * The target URL is user-controlled (anyone in a whitelisted group can type
 * `.youtube dl <url>`), so it MUST NEVER be interpolated into a shell command
 * string: a URL such as `https://evil.tild/$(id)x` would otherwise be expanded by
 * the shell. `execFile` bypasses the shell entirely.
 */
const execFileAsync = promisify(execFile);

// WhatsApp media upload limit. Files larger than this are rejected after download.
const MAX_FILESIZE_BYTES = 15 * 1024 * 1024;

/**
 * Short, filesystem-safe token for the output filename, derived from the resolved
 * quality. `describeVideoQuality` in the parser module owns the user-facing wording;
 * duplicating the human labels here would let the two drift apart.
 */
const VIDEO_QUALITY_FILE_TOKENS: Record<YouTubeVideoQuality, string> = {
    best: 'best',
    360: '360p',
    480: '480p',
    720: '720p',
    1080: '1080p',
    1440: '1440p',
    2160: '2160p'
};

export const definition: ToolDefinition = {
    name: 'ytdl',
    displayNames: { en: 'yt dl', id: 'yt unduh' },
    title: 'YouTube Downloader',
    category: 'Downloaders',
    // NOTE: `yt dl audio` / `youtube dl audio` are intentionally NOT registered as
    // aliases. The message handler resolves `.youtube dl audio <link>` greedily to
    // `.youtube dl` and forwards the leftover text, so the `audio` mode keyword is
    // parsed from the argument string inside the tool. Registering it as an alias
    // would consume the keyword and silently download the video stream instead.
    aliases: ['.yt', '.ytdl', '.youtube', 'yt dl', '.yt dl', 'youtube dl', '.youtube dl'],
    description:
        'Downloads YouTube media. Video downloads deliver the video stream only; use resolutions --360, --480, --720, --1k, --2k, --4k, --best. Append "audio" before the link and a bitrate flag (--128k, --192k, --320k, --best) for an MP3.',
    descriptionKey: 'tools.commands.ytdl.description',
    limitKey: 'download',
    limit: { max: 3, windowMs: 600_000 },
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description:
                    'The video URL. Use "audio <url>" for an audio-only MP3, optionally followed by --360/--480/--720/--1k/--2k/--4k/--best (video) or --128k/--192k/--320k/--best (audio).'
            }
        },
        required: ['url']
    }
};

/** Resolves the `yt-dlp` executable, preferring the pinned local installations. */
function resolveYtDlpPath(): string {
    const candidates = ['/usr/local/bin/yt-dlp', path.resolve(process.cwd(), 'yt-dlp')];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return 'yt-dlp';
}

/** Builds the shared `yt-dlp` argument vector used by both stream classes. */
function buildBaseArgs(): string[] {
    const args: string[] = ['--js-runtimes', 'node'];

    const cookiesPath = path.resolve(process.cwd(), 'cookies.txt');
    if (fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath);

    if (ffmpeg) args.push('--ffmpeg-location', ffmpeg as unknown as string);

    args.push('--extractor-args', 'youtube:player_client=android,web');
    return args;
}

/**
 * Filters and removes downloaded artefacts that breach the WhatsApp size limit.
 * Returns only the files that are safe to deliver.
 */
function collectDeliverableFiles(stdout: string): string[] {
    return stdout
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && fs.existsSync(line))
        .filter((file) => {
            try {
                if (fs.statSync(file).size > MAX_FILESIZE_BYTES) {
                    console.error(`[YTDL Tool] Downloaded file exceeds size limit (${file})`);
                    fs.unlinkSync(file);
                    return false;
                }
                return true;
            } catch {
                return false;
            }
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

/** Builds the info card shown alongside the delivered stream. */
function buildMediaCard(ctx: ToolContext, parsed: ParsedYouTubeArgs, fileCount: number): string {
    const isAudio = parsed.kind === 'audio';
    const items: Array<{ label: string; value: string }> = [
        {
            label: ctx.t('media.ytdl.label_type'),
            value: isAudio ? ctx.t('media.downloaders.value_audio_mp3') : ctx.t('media.downloaders.value_video_only')
        },
        {
            label: isAudio ? ctx.t('media.ytdl.label_bitrate') : ctx.t('media.ytdl.label_resolution'),
            value: isAudio ? describeAudioBitrate(parsed.audioBitrate) : describeVideoQuality(parsed.videoQuality)
        },
        {
            label: ctx.t('media.tiktokdl.label_status'),
            value:
                fileCount > 1
                    ? ctx.t('media.downloaders.value_files_ready', { count: String(fileCount) })
                    : isAudio
                      ? ctx.t('media.ytdl.audio_success')
                      : ctx.t('media.ytdl.video_success')
        }
    ];

    return renderCard({
        title: ctx.t('media.ytdl.card_title'),
        icon: isAudio ? '🎵' : '▶️',
        headerStyle: 'light',
        sections: [{ items }]
    });
}

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const senderJid = ctx.msg.key.participant || ctx.msg.key.remoteJid;
    const replyOptions = { quoted: ctx.msg };

    // The message handler assigns the whole argument string to the single declared
    // parameter, so the mode keyword and flags arrive together inside `args.url`.
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

    const parsed = parseYouTubeArgs(rawInput);

    if (parsed.unknownFlags.length > 0) {
        console.error(`[YTDL Tool] Rejected unknown flags: ${parsed.unknownFlags.join(', ')}`);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return buildRejectionCard(
            ctx,
            ctx.t(parsed.unknownFlagsKey!, { flags: parsed.unknownFlags.map((f) => `--${f}`).join(', ') }),
            [ctx.t('media.downloaders.hint_youtube_flags'), ctx.t('media.downloaders.hint_youtube_audio_flags')]
        );
    }

    if (parsed.conflict) {
        console.error(`[YTDL Tool] Rejected conflicting flags: ${parsed.conflict}`);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        const hints =
            parsed.conflict === 'video_quality_on_audio'
                ? [ctx.t('media.downloaders.hint_youtube_audio_flags'), ctx.t('media.downloaders.hint_youtube_flags')]
                : [ctx.t('media.downloaders.hint_youtube_flags'), ctx.t('media.downloaders.hint_youtube_audio_flags')];
        return buildRejectionCard(ctx, ctx.t(parsed.conflictKey!), hints);
    }

    if (!parsed.url) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return buildRejectionCard(ctx, ctx.t('media.ytdl.invalid_url'), [
            ctx.t('media.downloaders.usage_youtube'),
            ctx.t('media.downloaders.usage_youtube_audio')
        ]);
    }

    await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: ctx.msg.key } });

    const ytdlpPath = resolveYtDlpPath();
    const storagePath = path.resolve(process.cwd(), 'storage');
    if (!fs.existsSync(storagePath)) fs.mkdirSync(storagePath, { recursive: true });

    const timestamp = Date.now();
    const isAudio = parsed.kind === 'audio';
    const suffix = isAudio ? 'audio' : VIDEO_QUALITY_FILE_TOKENS[parsed.videoQuality];
    const outTemplate = path.join(storagePath, `ytdl_${timestamp}_${suffix}_%(id)s.%(ext)s`);

    // An explicit `.youtube dl` is video-only by design: merging audio in inflates
    // the file past the WhatsApp limit, and audio has its own dedicated command.
    // AutoDL, however, routes IG/Twitter/FB/Threads/YouTube through this tool and
    // those users expect sound, so `withAudio` requests a merged, size-capped
    // stream. This preserves the pre-existing AutoDL behaviour.
    const withAudio = args.withAudio === true && !isAudio;

    const streamArgs: string[] = [];
    if (isAudio) {
        streamArgs.push(...buildYouTubeAudioArgv(parsed.audioBitrate));
    } else if (withAudio) {
        // Merged best video + best audio, clamped to the WhatsApp delivery limit.
        // The size filter is repeated because YouTube's SABR-only streams often
        // omit an approximate filesize; the post-download stat check is the real guard.
        streamArgs.push(
            '-f',
            'bestvideo[filesize_approx<15M]+bestaudio[filesize_approx<15M]/best[filesize_approx<15M]'
        );
        streamArgs.push('--merge-output-format', 'mp4');
    } else {
        const format = buildYouTubeVideoFormat(parsed.videoQuality);
        // Both branches keep the requested height ceiling, so `--360` can never
        // silently ship a 4K stream through the size-filter fallback.
        streamArgs.push('-f', `${format}[filesize_approx<15M]/${format}`);
    }

    if (!isAudio) {
        // WhatsApp cannot reliably play VP9/AV1 in a webm/mkv container while the
        // message still declares video/mp4, so pin the codecs to H.264/AAC.
        streamArgs.push('-S', 'vcodec:h264,acodec:m4a');
    }

    const ytArgs = [...buildBaseArgs(), ...streamArgs, '-o', outTemplate, parsed.url, '--print', 'after_move:filepath'];

    let downloadedFiles: string[] = [];
    try {
        console.log(`[YTDL Tool] Executing ${isAudio ? 'audio' : withAudio ? 'merged' : 'video-only'} download`);
        const { stdout } = await execFileAsync(ytdlpPath, ytArgs, { maxBuffer: 1024 * 1024 * 20 });
        downloadedFiles = collectDeliverableFiles(stdout);
    } catch (e) {
        console.error('[YTDL Tool] Media download failed:', e);
    }

    if (downloadedFiles.length === 0) {
        console.error('[YTDL Tool] No deliverable file was produced.');
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return buildRejectionCard(ctx, ctx.t('media.downloaders.error_no_media'), [
            ctx.t('media.downloaders.hint_youtube_flags')
        ]);
    }

    const caption = buildMediaCard(ctx, parsed, downloadedFiles.length);
    const forwardContext = { isForwarded: true, forwardingScore: 1 };
    let isFirst = true;

    try {
        for (const file of downloadedFiles) {
            const ext = path.extname(file).toLowerCase();
            const mediaCaption = isFirst ? caption : undefined;
            let sentMsg: unknown;

            if (['.mp4', '.webm', '.mkv', '.m4v'].includes(ext)) {
                sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        video: { url: file },
                        mimetype: 'video/mp4',
                        caption: mediaCaption,
                        mentions: senderJid ? [senderJid] : undefined,
                        contextInfo: forwardContext
                    },
                    replyOptions
                );
            } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
                sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        image: { url: file },
                        caption: mediaCaption,
                        mentions: senderJid ? [senderJid] : undefined,
                        contextInfo: forwardContext
                    },
                    replyOptions
                );
            } else if (['.mp3', '.m4a', '.opus', '.ogg', '.wav', '.aac'].includes(ext)) {
                sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        audio: { url: file },
                        mimetype: ext === '.mp3' ? 'audio/mpeg' : 'audio/mp4',
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
                        document: { url: file },
                        mimetype: 'application/octet-stream',
                        fileName: path.basename(file),
                        caption: mediaCaption,
                        mentions: senderJid ? [senderJid] : undefined,
                        contextInfo: forwardContext
                    },
                    replyOptions
                );
            }

            if (sentMsg) {
                const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                const mediaType = ['.mp4', '.webm', '.mkv', '.m4v'].includes(ext)
                    ? 'video'
                    : ['.mp3', '.m4a', '.opus', '.ogg', '.wav', '.aac'].includes(ext)
                      ? 'audio'
                      : 'image';
                scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg as never, mediaType);
            }

            isFirst = false;
        }

        await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
        return;
    } catch (error: unknown) {
        console.error('[YTDL Tool] Execution error:', error);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    } finally {
        for (const file of downloadedFiles) {
            try {
                if (fs.existsSync(file)) fs.unlinkSync(file);
            } catch (err) {
                console.error(`[YTDL Tool] Failed to remove temporary file ${file}:`, err);
            }
        }
    }
}
