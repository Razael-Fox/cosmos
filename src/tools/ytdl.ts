import { ToolDefinition, ToolContext } from './types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'ffmpeg-static';
import { renderCard } from '../utils/uiFormatter.js';

const execAsync = promisify(exec);

// WhatsApp media upload limit. Files larger than this are rejected after download.
const MAX_FILESIZE_BYTES = 15 * 1024 * 1024;

export const definition: ToolDefinition = {
    name: 'ytdl',
    title: 'YouTube Downloader',
    category: 'Downloaders',
    aliases: ['.yt', '.ytdl', '.youtube'],
    description: 'Downloads a video from a specified URL using yt-dlp. Currently supports basic video fetching.',
    descriptionKey: 'tools.commands.ytdl.description',
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL of the video to download.'
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

    const candidates = ['/usr/local/bin/yt-dlp', path.resolve(process.cwd(), 'yt-dlp')];
    let ytdlpPath = 'yt-dlp';
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            ytdlpPath = candidate;
            break;
        }
    }
    const storagePath = path.resolve(process.cwd(), 'storage');

    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }

    const timestamp = Date.now();
    const outTemplate = path.join(storagePath, `ytdl_${timestamp}_%(id)s.%(ext)s`);

    try {
        const cookiesPath = path.resolve(process.cwd(), 'cookies.txt');
        const cookiesArg = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';

        // Limit the filesize to 15MB to ensure it can be sent via WhatsApp.
        // Note: use filesize_approx because YouTube SABR-only streams often lack an
        // exact filesize, which makes [filesize<15M] match nothing. Enforce the real
        // limit with a post-download stat check below.
        const ffmpegLoc = ffmpeg ? `--ffmpeg-location "${ffmpeg}"` : '';
        const baseCommand = `"${ytdlpPath}" --js-runtimes node ${cookiesArg} ${ffmpegLoc} --extractor-args "youtube:player_client=android,web"`;

        let downloadedFiles: string[] = [];
        try {
            // Note: Instagram carousels and other multi-media posts will output multiple lines.
            const vidCommand = `${baseCommand} -S "vcodec:h264,acodec:m4a" -f "bestvideo[filesize_approx<15M]+bestaudio/best[filesize_approx<15M]/best" --merge-output-format mp4 -o "${outTemplate}" "${targetUrl}" --print after_move:filepath`;
            const { stdout } = await execAsync(vidCommand);
            downloadedFiles = stdout
                .trim()
                .split('\n')
                .filter((line) => line.trim() !== '' && fs.existsSync(line.trim()))
                .map((l) => l.trim())
                .filter((file) => {
                    try {
                        if (fs.statSync(file).size > MAX_FILESIZE_BYTES) {
                            console.error(`[YTDL Tool] Downloaded file exceeds size limit (${file})`);
                            console.log(`[YTDL Tool] Downloaded file exceeds size limit (${file})`);
                            fs.unlinkSync(file);
                            return false;
                        }
                        return true;
                    } catch {
                        return false;
                    }
                });
        } catch (e) {
            console.error('[YTDL Tool] Media download failed:', e);
        }

        let downloadedAudioOnly = '';
        if (downloadedFiles.length === 0) {
            // Fallback for audio-only
            try {
                const audTemplate = path.join(storagePath, `ytdl_${timestamp}_audio.%(ext)s`);
                const audCommand = `${baseCommand} -f "bestaudio[filesize_approx<15M]/bestaudio/best" --extract-audio --audio-format mp3 -o "${audTemplate}" "${targetUrl}" --print after_move:filepath`;
                const { stdout } = await execAsync(audCommand);
                const outputLines = stdout
                    .trim()
                    .split('\n')
                    .filter((line) => line.trim() !== '' && fs.existsSync(line.trim()));
                if (outputLines.length > 0) {
                    const candidate = outputLines[outputLines.length - 1].trim();
                    try {
                        if (fs.statSync(candidate).size > MAX_FILESIZE_BYTES) {
                            console.error(`[YTDL Tool] Downloaded audio exceeds size limit (${candidate})`);
                            console.log(`[YTDL Tool] Downloaded audio exceeds size limit (${candidate})`);
                            fs.unlinkSync(candidate);
                        } else {
                            downloadedAudioOnly = candidate;
                        }
                    } catch {
                        // Ignore stat failures; treat as no download.
                    }
                }
            } catch (e) {
                console.error('[YTDL Tool] Audio download failed:', e);
            }
        }

        if (downloadedFiles.length === 0 && !downloadedAudioOnly) {
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return;
        }

        // Send all downloaded media files (for carousels)
        for (const file of downloadedFiles) {
            const ext = path.extname(file).toLowerCase();
            if (['.mp4', '.webm', '.mkv'].includes(ext)) {
                const videoCaption = renderCard({
                    title: ctx.t('media.ytdl.card_title'),
                    icon: '▶️',
                    headerStyle: 'light',
                    sections: [
                        {
                            items: [
                                { label: ctx.t('media.ytdl.label_type'), value: ctx.t('media.ytdl.value_video') },
                                {
                                    label: ctx.t('media.tiktokdl.label_status'),
                                    value: ctx.t('media.ytdl.video_success')
                                }
                            ]
                        }
                    ]
                });
                const sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        video: { url: file },
                        caption: videoCaption,
                        mentions: senderJid ? [senderJid] : undefined,
                        contextInfo: { isForwarded: true, forwardingScore: 1 }
                    },
                    { quoted: ctx.msg }
                );
                if (sentMsg) {
                    const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                    scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg, 'video');
                }
            } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
                const imageCaption = renderCard({
                    title: ctx.t('media.ytdl.card_title'),
                    icon: '🖼️',
                    headerStyle: 'light',
                    sections: [
                        {
                            items: [
                                { label: ctx.t('media.ytdl.label_type'), value: ctx.t('media.ytdl.value_image') },
                                {
                                    label: ctx.t('media.tiktokdl.label_status'),
                                    value: ctx.t('media.ytdl.image_success')
                                }
                            ]
                        }
                    ]
                });
                const sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        image: { url: file },
                        caption: imageCaption,
                        mentions: senderJid ? [senderJid] : undefined,
                        contextInfo: { isForwarded: true, forwardingScore: 1 }
                    },
                    { quoted: ctx.msg }
                );
                if (sentMsg) {
                    const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                    scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg, 'image');
                }
            } else {
                // Document fallback
                await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        document: { url: file },
                        mimetype: 'application/octet-stream',
                        fileName: path.basename(file),
                        mentions: senderJid ? [senderJid] : undefined,
                        contextInfo: { isForwarded: true, forwardingScore: 1 }
                    },
                    { quoted: ctx.msg }
                );
            }
            fs.unlinkSync(file);
        }

        if (downloadedAudioOnly && fs.existsSync(downloadedAudioOnly)) {
            const sentMsg = await ctx.sock.sendMessage(
                ctx.jid,
                {
                    audio: { url: downloadedAudioOnly },
                    mimetype: 'audio/mpeg',
                    mentions: senderJid ? [senderJid] : undefined,
                    contextInfo: { isForwarded: true, forwardingScore: 1 }
                },
                { quoted: ctx.msg }
            );
            if (sentMsg) {
                const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg, 'audio');
            }
            fs.unlinkSync(downloadedAudioOnly);
        }

        await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
        return;
    } catch (error: any) {
        console.error('[YTDL Tool] Execution error:', error);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    }
}
