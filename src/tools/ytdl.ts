import { ToolDefinition, ToolContext } from './types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'ffmpeg-static';
import { renderCard } from '../utils/uiFormatter.js';
import {
    ParsedYouTubeArgs,
    YouTubeVideoQuality,
    buildYouTubeAudioArgs,
    buildYouTubeVideoFormat,
    describeAudioBitrate,
    describeVideoQuality,
    parseYouTubeArgs
} from '../utils/downloaderArgs.js';

const execAsync = promisify(exec);

// WhatsApp media upload limit. Files larger than this are rejected after download.
const MAX_FILESIZE_BYTES = 15 * 1024 * 1024;

/** Human readable label for a resolved video resolution, used on the info card. */
const VIDEO_QUALITY_LABELS: Record<YouTubeVideoQuality, string> = {
    best: 'Best',
    360: '360p',
    480: '480p',
    720: '720p HD',
    1080: '1080p Full HD',
    1440: '1440p 2K QHD',
    2160: '2160p 4K UHD'
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

/** Builds the shared `yt-dlp` invocation prefix shared by both stream classes. */
function buildBaseCommand(ytdlpPath: string): string {
    const cookiesPath = path.resolve(process.cwd(), 'cookies.txt');
    const cookiesArg = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';
    const ffmpegLoc = ffmpeg ? `--ffmpeg-location "${ffmpeg}"` : '';
    return `"${ytdlpPath}" --js-runtimes node ${cookiesArg} ${ffmpegLoc} --extractor-args "youtube:player_client=android,web"`;
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
        return buildRejectionCard(ctx, ctx.t(parsed.unknownFlagsKey!), [
            ctx.t('media.downloaders.hint_youtube_flags'),
            ctx.t('media.downloaders.hint_youtube_audio_flags')
        ]);
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
    const suffix = isAudio ? 'audio' : VIDEO_QUALITY_LABELS[parsed.videoQuality].split(' ')[0];
    const outTemplate = path.join(storagePath, `ytdl_${timestamp}_${suffix}_%(id)s.%(ext)s`);
    const baseCommand = buildBaseCommand(ytdlpPath);

    // Video downloads intentionally target the video stream alone: merging audio in
    // inflates the file past the WhatsApp limit and audio has its own dedicated
    // command. Size filters are applied again after download as an exact guard.
    const formatSelector = isAudio
        ? buildYouTubeAudioArgs(parsed.audioBitrate)
        : `-f "${buildYouTubeVideoFormat(parsed.videoQuality)}[filesize_approx<15M]/${buildYouTubeVideoFormat(parsed.videoQuality)}[filesize<15M]/bestvideo"`;
    const outputFormatArg = isAudio ? '' : '--merge-output-format mp4';

    let downloadedFiles: string[] = [];
    try {
        const command = `${baseCommand} ${formatSelector} ${outputFormatArg} -o "${outTemplate}" "${parsed.url}" --print after_move:filepath`;
        console.log(`[YTDL Tool] Executing ${isAudio ? 'audio' : 'video-only'} download`);
        const { stdout } = await execAsync(command);
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
