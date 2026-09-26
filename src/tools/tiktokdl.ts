import { ToolDefinition, ToolContext } from './types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { renderCard } from '../utils/uiFormatter.js';

const execAsync = promisify(exec);

/** Transient directory for TikTok downloads; files are removed after delivery. */
const TEMP_MEDIA_DIR = path.join(os.tmpdir(), 'waf-tiktok');

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

export const definition: ToolDefinition = {
    name: 'tiktokdl',
    title: 'TikTok Downloader',
    category: 'Downloaders',
    aliases: ['.tiktok', '.tt', '.tiktokdl', '.ttdl', 'tiktok dl', '.tiktok dl'],
    description: 'Downloads a video from a specified TikTok URL.',
    descriptionKey: 'tools.commands.tiktokdl.description',
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL of the TikTok video to download.'
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

    if (targetUrl.includes('vt.tiktok.com') || targetUrl.includes('vm.tiktok.com')) {
        try {
            const res = await fetch(targetUrl, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
            targetUrl = res.url;
        } catch (e) {
            console.error('[TikTokDL Tool] Failed to resolve shortlink:', e);
        }
    }

    targetUrl = targetUrl.replace(/\/photo\//g, '/video/');

    const tempDir = ensureTempMediaDir();
    const timestamp = Date.now();
    const downloadedFiles: string[] = [];
    let slideshowOutput: string | null = null;

    try {
        const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}`;
        const res = await axios.get(apiUrl, { timeout: 15000 });
        if (res.data.code !== 0 || !res.data.data) {
            const apiMessage = res.data.msg || ctx.t('media.tiktokdl.unknown_error');
            throw new Error(ctx.t('media.tiktokdl.api_error', { message: apiMessage }));
        }

        const data = res.data.data;
        let baseCaption = data.title || '';
        if (baseCaption.length > 900) {
            baseCaption = baseCaption.substring(0, 900) + '...';
        }

        const items: Array<{ label: string; value: string }> = [];
        if (baseCaption) items.push({ label: ctx.t('media.tiktokdl.label_title'), value: baseCaption });
        if (data.author?.nickname)
            items.push({ label: ctx.t('media.tiktokdl.label_author'), value: String(data.author.nickname) });
        if (data.duration)
            items.push({
                label: ctx.t('media.tiktokdl.label_duration'),
                value: `${data.duration}s`
            });
        if (items.length === 0)
            items.push({
                label: ctx.t('media.tiktokdl.label_status'),
                value: ctx.t('media.tiktokdl.value_ready')
            });

        const mediaCaption = renderCard({
            title: ctx.t('media.tiktokdl.card_title'),
            icon: '🎬',
            headerStyle: 'light',
            sections: [
                {
                    items
                }
            ]
        });
        const slideshowCaption = mediaCaption;

        const downloadFile = async (url: string, ext: string, index: string = ''): Promise<string> => {
            const filepath = path.join(tempDir, `tiktok_${timestamp}_${index}${ext}`);
            const writer = fs.createWriteStream(filepath);
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream'
            });
            response.data.pipe(writer);
            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(filepath));
                writer.on('error', reject);
            });
        };

        if (data.images && data.images.length > 0) {
            for (let i = 0; i < data.images.length; i++) {
                const imgPath = await downloadFile(data.images[i], '.jpg', `img_${i}`);
                downloadedFiles.push(imgPath);
            }
            if (data.music) {
                const musicPath = await downloadFile(data.music, '.mp3', 'music');
                downloadedFiles.push(musicPath);
            }
        } else {
            if (data.play) {
                try {
                    const vidPath = await downloadFile(data.play, '.mp4', 'vid');
                    downloadedFiles.push(vidPath);
                } catch (e) {
                    console.error('[TikTokDL Tool] Video download failed:', e);
                }
            }
            if (data.music) {
                try {
                    const musicPath = await downloadFile(data.music, '.mp3', 'music');
                    downloadedFiles.push(musicPath);
                } catch (e) {
                    console.error('[TikTokDL Tool] Music download failed:', e);
                }
            }
        }

        if (downloadedFiles.length > 0) {
            let images = downloadedFiles.filter((f) =>
                ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(f).toLowerCase())
            );
            const audios = downloadedFiles.filter((f) =>
                ['.mp3', '.m4a', '.aac', '.wav'].includes(path.extname(f).toLowerCase())
            );
            const videos = downloadedFiles.filter((f) =>
                ['.mp4', '.webm', '.mkv', '.mov'].includes(path.extname(f).toLowerCase())
            );
            const others = downloadedFiles.filter(
                (f) => !images.includes(f) && !audios.includes(f) && !videos.includes(f)
            );

            if (images.length > 0 && audios.length > 0) {
                const audioFile = audios[0];
                const outputVideo = path.join(tempDir, `slideshow_${timestamp}.mp4`);
                slideshowOutput = outputVideo;
                try {
                    let filterComplex = '';
                    let inputs = '';
                    const targetImages = images.slice(0, 35);
                    for (let i = 0; i < targetImages.length; i++) {
                        if (i === targetImages.length - 1) {
                            inputs += `-loop 1 -i "${targetImages[i]}" `;
                        } else {
                            inputs += `-loop 1 -t 3 -i "${targetImages[i]}" `;
                        }
                        filterComplex += `[${i}:v]scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${i}];`;
                    }
                    inputs += `-i "${audioFile}" `;

                    if (targetImages.length > 1) {
                        let concatStr = '';
                        for (let i = 0; i < targetImages.length; i++) {
                            concatStr += `[v${i}]`;
                        }
                        filterComplex += `${concatStr}concat=n=${targetImages.length}:v=1:a=0[outv]`;
                    } else {
                        filterComplex = filterComplex.replace('[v0];', '[outv]');
                    }

                    const audioIdx = targetImages.length;
                    const ffmpegCommand = `"/usr/bin/ffmpeg" ${inputs} -filter_complex "${filterComplex}" -map "[outv]" -map ${audioIdx}:a -c:v libx264 -profile:v main -preset fast -crf 28 -c:a aac -b:a 128k -shortest -y "${outputVideo}"`;
                    await execAsync(ffmpegCommand);

                    const sentMsg = await ctx.sock.sendMessage(
                        ctx.jid,
                        {
                            video: { url: outputVideo },
                            mimetype: 'video/mp4',
                            caption: slideshowCaption,
                            mentions: senderJid ? [senderJid] : undefined,
                            contextInfo: { isForwarded: true, forwardingScore: 1 }
                        },
                        { quoted: ctx.msg }
                    );
                    if (sentMsg) {
                        const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                        scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg, 'video');
                    }
                    fs.unlinkSync(outputVideo);
                    images.forEach((img) => fs.existsSync(img) && fs.unlinkSync(img));
                    // Keep audios to be sent separately!

                    images = [];
                } catch (ffmpegErr) {
                    console.error('[TikTokDL Tool] Slideshow combine error:', ffmpegErr);
                }
            }

            const remainingFiles = [...videos, ...images, ...audios, ...others];
            for (const file of remainingFiles) {
                if (!fs.existsSync(file)) continue;
                const ext = path.extname(file).toLowerCase();

                let sentMsg;
                if (['.mp4', '.webm', '.mkv', '.mov'].includes(ext)) {
                    // Send the original media untouched; re-encoding produced files
                    // that recipients could not download.
                    sentMsg = await ctx.sock.sendMessage(
                        ctx.jid,
                        {
                            video: { url: file },
                            mimetype: 'video/mp4',
                            caption: mediaCaption,
                            mentions: senderJid ? [senderJid] : undefined,
                            contextInfo: { isForwarded: true, forwardingScore: 1 }
                        },
                        { quoted: ctx.msg }
                    );
                    if (sentMsg) {
                        const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                        scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg, 'video');
                    }
                    fs.unlinkSync(file);
                } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
                    sentMsg = await ctx.sock.sendMessage(
                        ctx.jid,
                        {
                            image: { url: file },
                            caption: mediaCaption,
                            mentions: senderJid ? [senderJid] : undefined,
                            contextInfo: { isForwarded: true, forwardingScore: 1 }
                        },
                        { quoted: ctx.msg }
                    );
                    if (sentMsg) {
                        const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                        scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg, 'image');
                    }
                    fs.unlinkSync(file);
                } else if (['.mp3', '.m4a', '.aac', '.wav'].includes(ext)) {
                    sentMsg = await ctx.sock.sendMessage(
                        ctx.jid,
                        {
                            audio: { url: file },
                            mimetype: AUDIO_MIME_TYPES[ext] || 'audio/mpeg',
                            mentions: senderJid ? [senderJid] : undefined,
                            contextInfo: { isForwarded: true, forwardingScore: 1 }
                        },
                        { quoted: ctx.msg }
                    );
                    if (sentMsg) {
                        const { scheduleMediaAutoDelete } = await import('../utils/autoDelete.js');
                        scheduleMediaAutoDelete(ctx.sock, ctx.jid, sentMsg, 'audio');
                    }
                    fs.unlinkSync(file);
                } else {
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
                    fs.unlinkSync(file);
                }
            }
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
            return;
        } else {
            console.error('[TikTokDL Tool] File not found after download.');
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return;
        }
    } catch (error: any) {
        console.error('[TikTokDL Tool] Execution error:', error);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return;
    } finally {
        // Guarantee no temporary artifacts survive the request, even on failure.
        safeUnlink(slideshowOutput);
        for (const file of downloadedFiles) safeUnlink(file);
    }
}
