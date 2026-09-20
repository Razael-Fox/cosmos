import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WASocket, proto, hkdf, MEDIA_PATH_MAP } from '@whiskeysockets/baileys';
import { StickerlyPackDetails } from '#services/stickerlyService.js';
import { MmsZipResult } from './stickerPackBuilder.js';

// Ensure the sticker-pack endpoint is registered in Baileys MMS path map
(MEDIA_PATH_MAP as any)['sticker-pack'] = '/mms/sticker-pack';

export interface StickerPackUploadResult {
    directPath: string;
    mediaKey: Buffer;
    fileSha256: Buffer;
    fileEncSha256: Buffer;
    fileLength: number;
}

/**
 * Encrypts and uploads the sticker pack ZIP to WhatsApp MMS servers using "WhatsApp Sticker Pack Keys".
 */
export async function uploadStickerPackMedia(sock: WASocket, zipBuffer: Buffer): Promise<StickerPackUploadResult> {
    const mediaKey = crypto.randomBytes(32);

    // Expand 32-byte media key to 112 bytes using HKDF with info "WhatsApp Sticker Pack Keys"
    const expandedMediaKey = hkdf(mediaKey, 112, { info: 'WhatsApp Sticker Pack Keys' });
    const iv = expandedMediaKey.slice(0, 16);
    const cipherKey = expandedMediaKey.slice(16, 48);
    const macKey = expandedMediaKey.slice(48, 80);

    // Encrypt zipBuffer with AES-256-CBC
    const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
    const encData = Buffer.concat([cipher.update(zipBuffer), cipher.final()]);

    // Sign with HMAC-SHA256 (HMAC over IV + ciphertext)
    const hmac = crypto.createHmac('sha256', macKey);
    hmac.update(iv);
    hmac.update(encData);
    const mac = hmac.digest().slice(0, 10);

    // Final payload is ciphertext + 10-byte MAC
    const finalEncBuffer = Buffer.concat([encData, mac]);

    const fileSha256 = crypto.createHash('sha256').update(zipBuffer).digest();
    const fileEncSha256 = crypto.createHash('sha256').update(finalEncBuffer).digest();

    // Write to temporary file for Baileys upload
    const tempFilePath = path.join(os.tmpdir(), `spack_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.enc`);
    fs.writeFileSync(tempFilePath, finalEncBuffer);

    try {
        const uploadResult = await sock.waUploadToServer(tempFilePath, {
            mediaType: 'sticker-pack' as any,
            fileEncSha256B64: fileEncSha256.toString('base64'),
            timeoutMs: 60000
        });

        if (!uploadResult?.directPath) {
            throw new Error('Upload succeeded but directPath is missing from WhatsApp response.');
        }

        return {
            directPath: uploadResult.directPath,
            mediaKey,
            fileSha256,
            fileEncSha256,
            fileLength: zipBuffer.length
        };
    } finally {
        if (fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch {
                /* ignore */
            }
        }
    }
}

/**
 * Constructs proto.Message.IStickerPackMessage and relays it via Baileys.
 */
export async function sendNativeStickerPackMessage(
    sock: WASocket,
    chatJid: string,
    packDetails: StickerlyPackDetails,
    uploadData: StickerPackUploadResult,
    stickersList: MmsZipResult['stickersList'],
    trayFileName: string
): Promise<any> {
    const stickerPackMessage: proto.Message.IStickerPackMessage = {
        stickerPackId: packDetails.packId,
        name: packDetails.name,
        publisher: packDetails.authorName || 'Sticker.ly',
        stickerPackOrigin: 2, // USER_CREATED
        stickerPackSize: uploadData.fileLength,
        stickers: stickersList,
        fileSha256: new Uint8Array(uploadData.fileSha256),
        fileEncSha256: new Uint8Array(uploadData.fileEncSha256),
        mediaKey: new Uint8Array(uploadData.mediaKey),
        directPath: uploadData.directPath,
        fileLength: uploadData.fileLength,
        mediaKeyTimestamp: Math.floor(Date.now() / 1000),
        trayIconFileName: trayFileName
    };

    return await sock.relayMessage(chatJid, { stickerPackMessage }, {});
}
