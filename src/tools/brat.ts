import sharp from 'sharp';
import axios from 'axios';
import { ToolDefinition, ToolContext } from './types.js';
import { sendStickerFromBuffer } from './sticker_maker.js';
import { cleanId } from '#utils/casino.js';

const BRAT_BASE_URL = 'https://api.siputzx.my.id/api/m/brat';
const DEFAULT_DELAY = 500;
const REQUEST_TIMEOUT_MS = 30000;

export const definition: ToolDefinition = {
    name: 'brat',
    title: 'Brat Sticker Generator',
    category: 'Media & Stickers',
    aliases: ['.brat', '.bratanimasi', '.bratanimated', 'brat animasi', 'brat animated'],
    description: 'Generates a Brat-style text sticker or animated sticker.',
    descriptionKey: 'tools.commands.brat.description',
    parameters: {
        type: 'object',
        properties: {
            text: {
                type: 'string',
                description: 'The text to generate on the Brat sticker.'
            },
            isAnimated: {
                type: 'boolean',
                description: 'Whether to generate an animated Brat sticker.'
            }
        },
        required: ['text']
    }
};

/**
 * Parses user input text or quoted text and detects whether animated mode is requested.
 */
export function parseBratInput(rawText: string): { text: string; isAnimated: boolean } {
    let text = rawText.trim();
    let isAnimated = false;

    // Check for animated subcommands/prefixes or flags
    // Supported triggers: "animasi <text>", "animated <text>", "--animated", "-a", etc.
    const animatedPrefixRegex = /^(?:animasi|animated)\s+(.+)$/i;
    const prefixMatch = text.match(animatedPrefixRegex);
    if (prefixMatch) {
        isAnimated = true;
        text = prefixMatch[1].trim();
    } else if (/\s+--(?:animasi|animated)$/i.test(text)) {
        isAnimated = true;
        text = text.replace(/\s+--(?:animasi|animated)$/i, '').trim();
    } else if (/\s+-(?:a|anim)$/i.test(text)) {
        isAnimated = true;
        text = text.replace(/\s+-(?:a|anim)$/i, '').trim();
    }

    return { text, isAnimated };
}

/**
 * Fetches the Brat image/gif buffer from the API.
 */
export async function fetchBratMedia(text: string, isAnimated: boolean): Promise<Buffer> {
    const params: Record<string, string | number | boolean> = {
        text,
        delay: DEFAULT_DELAY
    };

    if (isAnimated) {
        params.isAnimated = true;
    }

    const response = await axios.get(BRAT_BASE_URL, {
        params,
        responseType: 'arraybuffer',
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });

    return Buffer.from(response.data);
}

/**
 * Converts image or gif buffer to WhatsApp-compliant 512x512 WebP sticker buffer.
 */
export async function convertBratToSticker(buffer: Buffer, isAnimated: boolean): Promise<Buffer> {
    if (isAnimated) {
        // WhatsApp animated sticker constraints: 512x512, <= 1MB, webp format
        let webpBuffer = await sharp(buffer, { animated: true })
            .resize(512, 512, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .webp({ effort: 6, quality: 70 })
            .toBuffer();

        if (webpBuffer.length > 800 * 1024) {
            webpBuffer = await sharp(buffer, { animated: true })
                .resize(512, 512, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .webp({ effort: 6, quality: 40 })
                .toBuffer();
        }

        return webpBuffer;
    }

    // Static WebP sticker
    let webpBuffer = await sharp(buffer)
        .resize(512, 512, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .webp({ quality: 80 })
        .toBuffer();

    if (webpBuffer.length > 500 * 1024) {
        webpBuffer = await sharp(buffer)
            .resize(512, 512, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .webp({ quality: 50 })
            .toBuffer();
    }

    return webpBuffer;
}

export async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | null> {
    let input = typeof args.text === 'string' ? args.text.trim() : '';
    let isAnimated = Boolean(args.isAnimated);

    // If input is empty or invoked as command, inspect raw command text or quoted message
    const msg = ctx.msg;
    const rawMsgText = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();

    // Check if the command itself was triggered via .bratanimasi, .bratanimated, or "brat animasi", "brat animated"
    const firstTokens = rawMsgText.toLowerCase().replace(/^\./, '').split(/\s+/);
    const triggerWord = firstTokens[0] || '';
    const twoWordTrigger = firstTokens.slice(0, 2).join(' ');

    if (
        triggerWord === 'bratanimasi' ||
        triggerWord === 'bratanimated' ||
        twoWordTrigger === 'brat animasi' ||
        twoWordTrigger === 'brat animated'
    ) {
        isAnimated = true;
    }

    if (!input) {
        // Try extracting text from the command message body
        // Examples: ".brat hello world", ".brat animasi hello world", ".bratanimasi hello world"
        if (rawMsgText) {
            const parts = rawMsgText.split(/\s+/);
            if (twoWordTrigger === 'brat animasi' || twoWordTrigger === 'brat animated') {
                input = parts.slice(2).join(' ').trim();
            } else if (triggerWord === 'brat' || triggerWord === 'bratanimasi' || triggerWord === 'bratanimated') {
                input = parts.slice(1).join(' ').trim();
            }
        }

        // If still empty or user only gave flags (e.g. .brat animasi without text), check if quoting a text message
        if (!input || input === 'animasi' || input === 'animated' || input === '--animated' || input === '--animasi') {
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quotedMsg) {
                const quotedText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
                if (quotedText.trim()) {
                    input = quotedText.trim();
                }
            }
        }
    }

    // Parse any animated flags or prefix inside the input
    const parsed = parseBratInput(input);
    input = parsed.text;
    if (parsed.isAnimated) {
        isAnimated = true;
    }

    // If input became empty after stripping prefix/flag (e.g. user typed ".brat animasi" replying to a message)
    if (!input) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg) {
            const quotedText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
            if (quotedText.trim()) {
                input = quotedText.trim();
            }
        }
    }

    if (!input) {
        return ctx.t('media.brat.usage');
    }
    const senderCandidate = msg.key.participant || msg.key.remoteJid;
    const senderRaw = cleanId(senderCandidate) || '';
    const senderJid = senderRaw.length > 14 ? `${senderRaw}@lid` : `${senderRaw}@s.whatsapp.net`;

    try {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: msg.key } });

        const rawBuffer = await fetchBratMedia(input, isAnimated);
        const webpSticker = await convertBratToSticker(rawBuffer, isAnimated);

        await sendStickerFromBuffer(ctx.sock, ctx.jid, webpSticker, msg, senderJid ? [senderJid] : undefined, ctx.t);

        await ctx.sock.sendMessage(ctx.jid, { react: { text: '✅', key: msg.key } });
        return null;
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('[Brat Tool Error]', err);
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '❌', key: msg.key } });
        return ctx.t('media.brat.failed', { error: errorMessage });
    }
}
