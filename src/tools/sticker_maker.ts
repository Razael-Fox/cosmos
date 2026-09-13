import sharp from 'sharp';
import { downloadContentFromMessage, WASocket, WAMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { stickerQueue } from '#utils/stickerQueue.js';
import { ToolDefinition, ToolContext } from './types.js';

const execPromise = promisify(exec);

// Try to dynamically load ffmpeg-static if available
let ffmpegStaticPath: string | null = null;
try {
    const ffmpegStatic = await import('ffmpeg-static');
    ffmpegStaticPath = (ffmpegStatic as any).default || ffmpegStatic;
} catch {
    // Not available on this platform (e.g., Termux/Android)
}

async function getFFmpegPath(): Promise<string | null> {
    if (ffmpegStaticPath) {
        try {
            await execPromise(`"${ffmpegStaticPath}" -version`);
            return ffmpegStaticPath;
        } catch {
            // ffmpeg-static failed to execute
            ffmpegStaticPath = null;
        }
    }
    try {
        await execPromise('ffmpeg -version');
        return 'ffmpeg';
    } catch {
        const termuxPath = '/data/data/com.termux/files/usr/bin/ffmpeg';
        try {
            await execPromise(`"${termuxPath}" -version`);
            return termuxPath;
        } catch {
            return null;
        }
    }
}

const ALLOWED_FORMATS = ['mp4', 'gif', 'mov', 'webm', 'avi', 'mkv', '3gp'];
const FORMAT_REGEX = /^[a-zA-Z0-9]+$/;

export async function convertVideoToSticker(buffer: Buffer, format: string): Promise<Buffer> {
    if (!FORMAT_REGEX.test(format) || !ALLOWED_FORMATS.includes(format.toLowerCase())) {
        throw new Error('Media format is not supported or invalid.');
    }

    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `temp_sticker_in_${crypto.randomUUID()}.${format}`);

    try {
        await fs.promises.writeFile(inputPath, buffer);
        const ffmpegCmd = await getFFmpegPath();
        if (!ffmpegCmd) {
            throw new Error('FFmpeg not found on system.');
        }

        const qualities = [65, 40, 25];
        let outputBuffer: Buffer | null = null;

        for (const q of qualities) {
            const outputPath = path.join(tempDir, `temp_sticker_out_${crypto.randomUUID()}.webp`);
            try {
                // Convert to animated webp: 512x512 crop/scale, max 10s, 12fps, loop infinitely, set quality
                const command = `"${ffmpegCmd}" -y -i "${inputPath}" -t 10 -vcodec libwebp -filter_complex "scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=12" -loop 0 -preset default -an -vsync 0 -q:v ${q} "${outputPath}"`;
                await execPromise(command);
                const fileBuffer = await fs.promises.readFile(outputPath);

                if (fileBuffer.length <= 500 * 1024 || q === qualities[qualities.length - 1]) {
                    outputBuffer = fileBuffer;
                    break;
                }
            } catch (err) {
                console.error(`Error encoding at quality ${q}:`, err);
            } finally {
                try {
                    if (fs.existsSync(outputPath)) await fs.promises.unlink(outputPath);
                } catch {
                    // Ignore unlinking errors
                }
            }
        }

        if (!outputBuffer) {
            throw new Error('Failed to process video into a sticker.');
        }

        return outputBuffer;
    } finally {
        try {
            if (fs.existsSync(inputPath)) await fs.promises.unlink(inputPath);
        } catch (e) {
            console.error('Failed to delete temporary file:', e);
        }
    }
}

export async function convertGifToStickerSharp(buffer: Buffer): Promise<Buffer> {
    const quality = 70;
    let webpBuffer = await sharp(buffer, { animated: true })
        .resize(512, 512, { fit: 'cover' })
        .webp({ effort: 6, quality })
        .toBuffer();

    if (webpBuffer.length > 500 * 1024) {
        webpBuffer = await sharp(buffer, { animated: true })
            .resize(512, 512, { fit: 'cover' })
            .webp({ effort: 6, quality: 40 })
            .toBuffer();
    }
    return webpBuffer;
}

/**
 * Send a WebP sticker buffer directly to WhatsApp and cache for retry decryption.
 */
export async function sendStickerFromBuffer(
    sock: WASocket,
    jid: string,
    webpBuffer: Buffer,
    quotedMsg: WAMessage | null | undefined,
    mentions?: string[]
): Promise<any> {
    // Validate WebP header (RIFF....WEBP)
    if (webpBuffer.length < 12) {
        throw new Error(`Buffer is too small (${webpBuffer.length} bytes), not a valid WebP file.`);
    }
    const riffHeader = webpBuffer.subarray(0, 4).toString('ascii');
    const webpMagic = webpBuffer.subarray(8, 12).toString('ascii');
    if (riffHeader !== 'RIFF' || webpMagic !== 'WEBP') {
        throw new Error(`Buffer is not a valid WebP format. Header: ${riffHeader}, Magic: ${webpMagic}`);
    }

    console.log(`[Sticker] WebP buffer valid, size: ${webpBuffer.length} bytes`);

    // Send sticker
    const sentMsg = await sock.sendMessage(
        jid,
        { sticker: webpBuffer, mentions },
        quotedMsg ? { quoted: quotedMsg } : undefined
    );

    console.log('[Sticker] sendMessage result key:', JSON.stringify(sentMsg?.key));
    if (sentMsg?.message?.stickerMessage) {
        const sm = sentMsg.message.stickerMessage;
        console.log(
            '[Sticker] stickerMessage details:',
            JSON.stringify({
                url: sm.url,
                directPath: sm.directPath,
                mediaKeyPresent: !!sm.mediaKey,
                fileSha256Present: !!sm.fileSha256,
                fileLength: sm.fileLength,
                mimetype: sm.mimetype
            })
        );
    }

    // Cache for getMessage retry callback
    if (sentMsg?.key?.id && sentMsg?.message) {
        const { cacheMessage } = await import('#utils/messageCache.js');
        cacheMessage(sentMsg);
        console.log('[Sticker] Sent message cached for retry decryption, id:', sentMsg.key.id);
    }

    return sentMsg;
}

export const definition: ToolDefinition = {
    name: 'sticker_maker',
    title: 'Sticker Maker',
    category: 'Media & Stickers',
    aliases: ['.sticker', '.s', '.stiker'],
    description: 'Creates a sticker from an image, video, or GIF sent by the user.',
    descriptionKey: 'tools.commands.sticker_maker.description',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

const MAX_MEDIA_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB limit

function getMediaFileLength(msg: any): number {
    if (!msg || !msg.fileLength) return 0;
    const len = msg.fileLength;
    if (typeof len === 'number') return len;
    if (typeof len === 'string') return parseInt(len, 10) || 0;
    if (typeof len === 'object') {
        if (typeof len.toNumber === 'function') return len.toNumber();
        return Number(len.low ?? len.unsigned ?? 0);
    }
    return 0;
}

export async function execute(_: Record<string, any>, ctx: ToolContext): Promise<string | null> {
    const getMessage = (m: any): { msg: any; isViewOnce: boolean } => {
        if (!m) return { msg: null, isViewOnce: false };
        if (m.viewOnceMessage?.message) {
            const res = getMessage(m.viewOnceMessage.message);
            return { msg: res.msg, isViewOnce: true };
        }
        if (m.viewOnceMessageV2?.message) {
            const res = getMessage(m.viewOnceMessageV2.message);
            return { msg: res.msg, isViewOnce: true };
        }
        if (m.viewOnceMessageV2Extension?.message) {
            const res = getMessage(m.viewOnceMessageV2Extension.message);
            return { msg: res.msg, isViewOnce: true };
        }
        return { msg: m, isViewOnce: false };
    };

    const direct = getMessage(ctx.msg.message);
    const quoted = getMessage(ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage);

    const directMsg = direct.msg;
    const quotedMsg = quoted.msg;
    const isViewOnce = direct.isViewOnce || quoted.isViewOnce;

    if (isViewOnce) {
        console.log('[Sticker Maker] Detected View Once media.');
    }

    const imageMessage = directMsg?.imageMessage || quotedMsg?.imageMessage;
    const videoMessage = directMsg?.videoMessage || quotedMsg?.videoMessage;
    const documentMessage = directMsg?.documentMessage || quotedMsg?.documentMessage;

    const isGifDocument =
        documentMessage && (documentMessage.mimetype === 'image/gif' || documentMessage.fileName?.endsWith('.gif'));

    const senderJid = ctx.msg.key.participant || ctx.msg.key.remoteJid;

    if (!imageMessage && !videoMessage && !isGifDocument) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return null;
    }

    // Pre-download file size check (15MB max)
    const targetMedia = imageMessage || videoMessage || documentMessage;
    const mediaSize = getMediaFileLength(targetMedia);
    if (mediaSize > MAX_MEDIA_SIZE_BYTES) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return null;
    }

    return stickerQueue.add(async () => {
        try {
            let buffer: Buffer;
            let mimeType: string | undefined;
            let ext = 'mp4';

            if (imageMessage) {
                const stream = await downloadContentFromMessage(imageMessage, 'image');
                const chunks: Buffer[] = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                buffer = Buffer.concat(chunks);

                let webpBuffer = await sharp(buffer)
                    .resize(512, 512, { fit: 'cover' })
                    .webp({ quality: 80 })
                    .toBuffer();

                if (webpBuffer.length > 100 * 1024) {
                    webpBuffer = await sharp(buffer)
                        .resize(512, 512, { fit: 'cover' })
                        .webp({ quality: 50 })
                        .toBuffer();
                }
                if (webpBuffer.length > 100 * 1024) {
                    webpBuffer = await sharp(buffer)
                        .resize(512, 512, { fit: 'cover' })
                        .webp({ quality: 30 })
                        .toBuffer();
                }

                await sendStickerFromBuffer(
                    ctx.sock,
                    ctx.jid,
                    webpBuffer,
                    ctx.msg,
                    senderJid ? [senderJid] : undefined
                );
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
                return null;
            }

            if (videoMessage) {
                const stream = await downloadContentFromMessage(videoMessage, 'video');
                const chunks: Buffer[] = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                buffer = Buffer.concat(chunks);
                const rawMime = videoMessage.mimetype || 'video/mp4';
                mimeType = rawMime;
                ext = rawMime.split('/')[1] || 'mp4';
            } else if (isGifDocument) {
                const stream = await downloadContentFromMessage(documentMessage, 'document');
                const chunks: Buffer[] = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                buffer = Buffer.concat(chunks);
                mimeType = 'image/gif';
                ext = 'gif';
            } else {
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
                return null;
            }

            if (ext) {
                ext = ext.split(';')[0].trim();
            }

            const ffmpegCmd = await getFFmpegPath();
            if (ffmpegCmd) {
                const webpBuffer = await convertVideoToSticker(buffer, ext);
                await sendStickerFromBuffer(
                    ctx.sock,
                    ctx.jid,
                    webpBuffer,
                    ctx.msg,
                    senderJid ? [senderJid] : undefined
                );
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
                return null;
            } else if (mimeType === 'image/gif' || ext === 'gif') {
                const webpBuffer = await convertGifToStickerSharp(buffer);
                await sendStickerFromBuffer(
                    ctx.sock,
                    ctx.jid,
                    webpBuffer,
                    ctx.msg,
                    senderJid ? [senderJid] : undefined
                );
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
                return null;
            } else {
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
                return null;
            }
        } catch (err: any) {
            console.error(err);
            console.error('Error in sticker_maker tool execution', err);
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return null;
        }
    });
}
