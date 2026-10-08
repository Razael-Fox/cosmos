import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import axios from 'axios';
import FormData from 'form-data';
import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ToolDefinition, ToolContext } from '../types.js';

const BGREMOVE_API_URL = 'https://bgninja.com/api/remove';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20000;

export const STORAGE_TMP = path.join(process.cwd(), 'storage', 'tmp');

function sweepStaleDirs(): void {
    try {
        if (!fs.existsSync(STORAGE_TMP)) return;
        for (const entry of fs.readdirSync(STORAGE_TMP)) {
            if (!entry.startsWith('bgremove_')) continue;
            try {
                fs.rmSync(path.join(STORAGE_TMP, entry), { recursive: true, force: true });
            } catch {
                // Ignore individual sweep failures
            }
        }
    } catch {
        // Ignore sweep failures entirely
    }
}

sweepStaleDirs();

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

const DOWNLOAD_TIMEOUT_CODE = 'BGREMOVE_DOWNLOAD_TIMEOUT';

export function withDeadline<T>(task: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<T>((_, reject) => {
        timer = setTimeout(
            () => reject(Object.assign(new Error('Download timed out'), { code: DOWNLOAD_TIMEOUT_CODE })),
            ms
        );
        if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
            (timer as unknown as { unref: () => void }).unref();
        }
    });
    return Promise.race([
        task.then(
            (value) => {
                if (timer) clearTimeout(timer);
                return value;
            },
            (err) => {
                if (timer) clearTimeout(timer);
                throw err;
            }
        ),
        deadline
    ]);
}

async function downloadImageBytes(imageMessage: any): Promise<Buffer | null> {
    const stream = await downloadContentFromMessage(imageMessage, 'image');
    const chunks: Buffer[] = [];
    let downloadedBytes = 0;
    for await (const chunk of stream) {
        downloadedBytes += (chunk as Buffer).length;
        if (downloadedBytes > MAX_IMAGE_BYTES) return null;
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

function extFromMimetype(mimetype?: string): string {
    if (!mimetype) return 'jpg';
    const sub = mimetype.split('/')[1]?.split(';')[0].trim().toLowerCase();
    if (sub === 'jpeg') return 'jpg';
    if (sub === 'png' || sub === 'webp' || sub === 'jpg') return sub;
    return 'jpg';
}

function isImageBuffer(buf: Buffer): boolean {
    if (buf.length < 8) return false;
    // PNG magic
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
    // JPEG magic
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
    // WebP magic RIFF....WEBP
    if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP')
        return true;
    return false;
}

export const definition: ToolDefinition = {
    name: 'remove background',
    displayNames: { en: 'remove background', id: 'hapus latar belakang' },
    title: 'Background Remover',
    category: 'Media & Stickers',
    aliases: [
        'remove background',
        '.remove background',
        'remove bg',
        '.remove bg',
        'removebg',
        '.removebg',
        'bg remove',
        '.bg remove',
        'hapus latar',
        '.hapus latar',
        'hapus background',
        '.hapus background',
        'rbg',
        '.rbg'
    ],
    description:
        'Removes the background from an attached or quoted image and returns a transparent PNG. The image is processed remotely.',
    descriptionKey: 'tools.commands.remove_background.description',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

export async function execute(_: Record<string, any>, ctx: ToolContext): Promise<string | null> {
    const getMessage = (m: any): any => {
        if (!m) return null;
        if (m.ephemeralMessage?.message) return getMessage(m.ephemeralMessage.message);
        if (m.viewOnceMessage?.message) return getMessage(m.viewOnceMessage.message);
        if (m.viewOnceMessageV2?.message) return getMessage(m.viewOnceMessageV2.message);
        if (m.viewOnceMessageV2Extension?.message) return getMessage(m.viewOnceMessageV2Extension.message);
        return m;
    };

    const direct = getMessage(ctx.msg.message);
    const quoted = getMessage(ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage);
    const imageMessage = direct?.imageMessage ?? quoted?.imageMessage;

    if (!imageMessage) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return ctx.t('media.bgremove.no_image');
    }

    if (getMediaFileLength(imageMessage) > MAX_IMAGE_BYTES) {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        return ctx.t('media.bgremove.too_large');
    }

    const dir = path.join(STORAGE_TMP, `bgremove_${crypto.randomUUID()}`);
    try {
        fs.mkdirSync(dir, { recursive: true });
        const mimetype: string = imageMessage.mimetype ?? 'image/jpeg';
        const ext = extFromMimetype(mimetype);
        const inputPath = path.join(dir, `input.${ext}`);
        const outputPath = path.join(dir, 'output.png');

        let inputBuffer: Buffer | null;
        try {
            inputBuffer = await withDeadline(downloadImageBytes(imageMessage), REQUEST_TIMEOUT_MS);
        } catch (dlErr: any) {
            if (dlErr?.code === DOWNLOAD_TIMEOUT_CODE) {
                console.error(`[BackgroundRemover] Media download timed out after ${REQUEST_TIMEOUT_MS}ms`);
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
                return ctx.t('media.bgremove.timeout');
            }
            throw dlErr;
        }
        if (!inputBuffer) {
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return ctx.t('media.bgremove.too_large');
        }
        await fs.promises.writeFile(inputPath, inputBuffer);

        const form = new FormData();
        form.append('file', fs.createReadStream(inputPath), {
            filename: `input.${ext}`,
            contentType: mimetype
        });

        const startedAt = Date.now();
        let response;
        try {
            response = await axios.post(BGREMOVE_API_URL, form, {
                headers: form.getHeaders(),
                timeout: REQUEST_TIMEOUT_MS,
                responseType: 'arraybuffer',
                maxBodyLength: Infinity,
                maxContentLength: MAX_IMAGE_BYTES
            });
        } catch (err: any) {
            const latency = Date.now() - startedAt;
            const status = err?.response?.status ?? 'no-response';
            console.error(
                `[BackgroundRemover] Upstream request failed status=${status} latency=${latency}ms: ${err?.message}`
            );
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            if (/maxContentLength/i.test(err?.message ?? '')) {
                return ctx.t('media.bgremove.too_large');
            }
            if (err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message ?? '')) {
                return ctx.t('media.bgremove.timeout');
            }
            return ctx.t('media.bgremove.api_failed');
        }
        const latency = Date.now() - startedAt;

        if (response.status !== 200 || !response.data || (response.data as Buffer).length === 0) {
            console.error(`[BackgroundRemover] Upstream bad response status=${response.status} latency=${latency}ms`);
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return ctx.t('media.bgremove.api_failed');
        }

        const result = Buffer.from(response.data);
        if (!isImageBuffer(result)) {
            console.error(
                `[BackgroundRemover] Upstream returned non-image body status=${response.status} latency=${latency}ms size=${result.length}`
            );
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return ctx.t('media.bgremove.invalid_result');
        }
        try {
            const meta = await sharp(result).metadata();
            if (meta.format !== 'png' || meta.hasAlpha !== true) {
                console.error(
                    `[BackgroundRemover] Upstream result is not a transparent PNG format=${meta.format} hasAlpha=${meta.hasAlpha} size=${result.length}`
                );
                await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
                return ctx.t('media.bgremove.invalid_result');
            }
        } catch (metaErr: any) {
            console.error(
                `[BackgroundRemover] Upstream body failed image validation size=${result.length}: ${metaErr?.message}`
            );
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
            return ctx.t('media.bgremove.invalid_result');
        }

        await fs.promises.writeFile(outputPath, result);
        const outBuffer = await fs.promises.readFile(outputPath);
        await ctx.sock.sendMessage(
            ctx.jid,
            { image: outBuffer, caption: ctx.t('media.bgremove.success') },
            { quoted: ctx.msg }
        );
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: ctx.msg.key } });
        return null;
    } catch (err: any) {
        console.error(`[BackgroundRemover] Execution failed: ${err?.message}`, err);
        try {
            await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: ctx.msg.key } });
        } catch {
            // Ignore react failures
        }
        return ctx.t('media.bgremove.api_failed');
    } finally {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup failures
        }
    }
}
