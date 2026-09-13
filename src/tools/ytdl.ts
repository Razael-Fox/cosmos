import { ToolDefinition, ToolContext } from './types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'ffmpeg-static';

const execAsync = promisify(exec);

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
        const ffmpegLoc = ffmpeg ? `--ffmpeg-location "${ffmpeg}"` : '';
        const baseCommand = `"${ytdlpPath}" --js-runtimes node ${cookiesArg} ${ffmpegLoc} --extractor-args "youtube:player_client=android,web"`;

        let downloadedFiles: string[] = [];
        try {
            // Note: Instagram carousels and other multi-media posts will output multiple lines.
            const vidCommand = `${baseCommand} -S "vcodec:h264,acodec:m4a" -f "bestvideo[filesize<15M]+bestaudio/best[filesize<15M]" --merge-output-format mp4 -o "${outTemplate}" "${targetUrl}" --print after_move:filepath`;
            const { stdout } = await execAsync(vidCommand);
            downloadedFiles = stdout
                .trim()
                .split('\n')
                .filter((line) => line.trim() !== '' && fs.existsSync(line.trim()))
                .map((l) => l.trim());
        } catch (e) {
            console.error('[YTDL Tool] Media download failed:', e);
        }

        let downloadedAudioOnly = '';
        if (downloadedFiles.length === 0) {
            // Fallback for audio-only
            try {
                const audTemplate = path.join(storagePath, `ytdl_${timestamp}_audio.%(ext)s`);
                const audCommand = `${baseCommand} -f "bestaudio[filesize<15M]/bestaudio" --extract-audio --audio-format mp3 -o "${audTemplate}" "${targetUrl}" --print after_move:filepath`;
                const { stdout } = await execAsync(audCommand);
                const outputLines = stdout
                    .trim()
                    .split('\n')
                    .filter((line) => line.trim() !== '' && fs.existsSync(line.trim()));
                if (outputLines.length > 0) downloadedAudioOnly = outputLines[outputLines.length - 1].trim();
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
                const sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        video: { url: file },
                        caption: ctx.t('media.ytdl.video_success'),
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
                const sentMsg = await ctx.sock.sendMessage(
                    ctx.jid,
                    {
                        image: { url: file },
                        caption: ctx.t('media.ytdl.image_success'),
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
