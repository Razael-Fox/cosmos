import sharp from 'sharp';
import crypto from 'crypto';
import { zipSync, strToU8 } from 'fflate';
import { StickerlyPackDetails } from '#services/stickerlyService.js';

export interface ProcessedSticker {
    buffer: Buffer;
    isAnimated: boolean;
    emojis: string[];
}

export interface MmsZipResult {
    zipBuffer: Buffer;
    stickersList: Array<{
        fileName: string;
        mimetype: string;
        isAnimated: boolean;
        emojis: string[];
    }>;
    trayFileName: string;
}

/**
 * Validates whether a buffer begins with the RIFF/WEBP magic header.
 */
export function isValidWebP(buffer: Buffer): boolean {
    if (buffer.length < 12) return false;
    return buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
}

/**
 * Normalizes sticker image buffer to WhatsApp standard 512x512 WebP with transparent canvas.
 * Per Rule 8: Animated stickers from Sticker.ly are already valid WebPs and should be
 * preserved as-is without re-encoding to avoid frame stripping, unless exceeding WhatsApp's 1MB limit.
 */
export async function normalizeStickerBuffer(rawBuffer: Buffer, isAnimated: boolean): Promise<Buffer> {
    const oneMb = 1024 * 1024;

    if (isAnimated) {
        if (isValidWebP(rawBuffer)) {
            if (rawBuffer.length <= oneMb) {
                return rawBuffer;
            }
            // If animated WebP exceeds 1MB, compress it down
            return await sharp(rawBuffer, { animated: true })
                .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .webp({ quality: 60, effort: 4 })
                .toBuffer();
        }

        // Animated media not yet in WebP format (e.g. GIF)
        return await sharp(rawBuffer, { animated: true })
            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp({ quality: 75, effort: 4 })
            .toBuffer();
    }

    // Static image: Normalize to 512x512 WebP with transparent background and quality 80
    return await sharp(rawBuffer)
        .resize(512, 512, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
}

/**
 * Generates standard 252x252 PNG tray icon.
 */
export async function generateTrayIcon(buffer: Buffer): Promise<Buffer> {
    return await sharp(buffer)
        .resize(252, 252, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();
}

/**
 * Builds standard .wastickers container for third-party sticker maker apps.
 * Structure: author.txt, title.txt, tray.png, and indexed WebP sticker files.
 */
export function buildWastickersZip(
    packDetails: StickerlyPackDetails,
    stickers: ProcessedSticker[],
    trayPngBuffer: Buffer
): Buffer {
    const files: Record<string, Uint8Array> = {
        'author.txt': strToU8(packDetails.authorName || 'Sticker.ly'),
        'title.txt': strToU8(packDetails.name || 'Sticker Pack'),
        'tray.png': new Uint8Array(trayPngBuffer)
    };

    stickers.forEach((s, idx) => {
        const numStr = String(idx + 1).padStart(2, '0');
        files[`${numStr}.webp`] = new Uint8Array(s.buffer);
    });

    return Buffer.from(zipSync(files));
}

/**
 * Builds WhatsApp MMS payload ZIP container.
 * Contains all stickers formatted as ${sha256}.webp and tray icon as ${packId}.png.
 */
export function buildMmsZip(
    packDetails: StickerlyPackDetails,
    stickers: ProcessedSticker[],
    trayPngBuffer: Buffer
): MmsZipResult {
    const files: Record<string, Uint8Array> = {};
    const trayFileName = `${packDetails.packId}.png`;
    files[trayFileName] = new Uint8Array(trayPngBuffer);

    const stickersList: MmsZipResult['stickersList'] = [];

    for (const sticker of stickers) {
        const hash = crypto.createHash('sha256').update(sticker.buffer).digest('hex');
        const fileName = `${hash}.webp`;

        files[fileName] = new Uint8Array(sticker.buffer);
        stickersList.push({
            fileName,
            mimetype: 'image/webp',
            isAnimated: sticker.isAnimated,
            emojis: sticker.emojis.length > 0 ? sticker.emojis : ['✨']
        });
    }

    const zipBuffer = Buffer.from(zipSync(files));

    return {
        zipBuffer,
        stickersList,
        trayFileName
    };
}
