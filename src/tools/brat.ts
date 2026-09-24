import sharp from 'sharp';
import axios from 'axios';
import { ToolDefinition, ToolContext } from './types.js';
import { sendStickerFromBuffer } from './sticker_maker.js';
import { cleanId } from '#utils/casino.js';
import { unwrapMonospace } from '#utils/monospace.js';

const BRAT_BASE_URL = 'https://api.siputzx.my.id/api/m/brat';
const DEFAULT_DELAY = 500;
const MIN_DELAY = 50;
const MAX_DELAY = 5000;
const REQUEST_TIMEOUT_MS = 30000;

export const definition: ToolDefinition = {
    name: 'brat',
    title: 'Brat Sticker Generator',
    category: 'Media & Stickers',
    aliases: ['.brat', '.bratanimasi', '.bratanimated', 'brat animasi', 'brat animated'],
    description:
        'Create Brat text stickers or animated stickers with customizable delay. Usage: .brat <text> or .brat animated <text> [-d <ms>]. Example: .brat Hello World, .brat animated -d 300 Hello, or .brat "animasi keren" for literal static text.',
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
            },
            delay: {
                type: 'number',
                description: 'Frame delay in milliseconds for animated stickers (default: 500, range: 50-5000).'
            }
        },
        required: ['text']
    }
};

export interface ParsedBratInput {
    text: string;
    isAnimated: boolean;
    delay: number;
    forceStatic: boolean;
}

/**
 * Parses user input text or quoted text and detects whether animated mode is requested,
 * extracts optional delay (supporting dash parameters -d <ms>, -d<ms>, --delay <ms>, -<digits>ms),
 * and handles intentional literal static overrides (e.g. quotes, monospace, or -s / --static).
 */
export function parseBratInput(rawText: string, defaultAnimated = false): ParsedBratInput {
    let text = rawText.trim();
    let isAnimated = defaultAnimated;
    let delay = DEFAULT_DELAY;
    let forceStatic = false;

    // Check for explicit static flags (e.g., -s, --static, --no-anim)
    if (/(?:^|\s+)-(?:s|static)(?:\s+|$)/i.test(text)) {
        forceStatic = true;
        text = text.replace(/(?:^|\s+)-(?:s|static)(?:\s+|$)/i, ' ').trim();
    } else if (/(?:^|\s+)--(?:static|no-anim)(?:\s+|$)/i.test(text)) {
        forceStatic = true;
        text = text.replace(/(?:^|\s+)--(?:static|no-anim)(?:\s+|$)/i, ' ').trim();
    }

    // Check for WhatsApp monospace or quoted literal string (e.g. .brat ```animasi keren``` or .brat "animasi keren")
    const unwrapped = unwrapMonospace(text);
    if (unwrapped.wasWrapped) {
        text = unwrapped.text;
        forceStatic = true;
    }

    // Extract delay parameter:
    // 1. Dash format with flag: -d <ms>, -d=<ms>, -d<ms>, --delay <ms>, --delay=<ms>
    const dashFlagRegex = /(?:^|\s+)(?:--(?:delay|d)|-d)(?:=|\s*)(\d+)(?:\s+|$)/i;
    const dashFlagMatch = text.match(dashFlagRegex);
    if (dashFlagMatch) {
        const parsedDelay = parseInt(dashFlagMatch[1], 10);
        if (!Number.isNaN(parsedDelay)) {
            delay = Math.min(Math.max(parsedDelay, MIN_DELAY), MAX_DELAY);
        }
        text = text.replace(dashFlagRegex, ' ').trim();
    } else {
        // 2. Dash format with unit suffix: -<ms>ms or -<ms> (e.g. -300ms or -300) when animated
        const dashUnitRegex = /(?:^|\s+)-(\d{2,4})(?:ms)?(?:\s+|$)/i;
        const dashUnitMatch = text.match(dashUnitRegex);
        if (dashUnitMatch) {
            const parsedDelay = parseInt(dashUnitMatch[1], 10);
            if (!Number.isNaN(parsedDelay)) {
                delay = Math.min(Math.max(parsedDelay, MIN_DELAY), MAX_DELAY);
            }
            text = text.replace(dashUnitRegex, ' ').trim();
        } else {
            // 3. Alternative colon syntax: delay:<ms>
            const colonDelayRegex = /(?:^|\s+)delay:(\d+)(?:\s+|$)/i;
            const colonMatch = text.match(colonDelayRegex);
            if (colonMatch) {
                const parsedDelay = parseInt(colonMatch[1], 10);
                if (!Number.isNaN(parsedDelay)) {
                    delay = Math.min(Math.max(parsedDelay, MIN_DELAY), MAX_DELAY);
                }
                text = text.replace(colonDelayRegex, ' ').trim();
            }
        }
    }

    // Check for animated flags (--animated, --animasi, -a, -anim)
    if (!forceStatic) {
        if (/(?:^|\s+)--(?:animated|animasi)(?:\s+|$)/i.test(text)) {
            isAnimated = true;
            text = text.replace(/(?:^|\s+)--(?:animated|animasi)(?:\s+|$)/i, ' ').trim();
        } else if (/(?:^|\s+)-(?:a|anim)(?:\s+|$)/i.test(text)) {
            isAnimated = true;
            text = text.replace(/(?:^|\s+)-(?:a|anim)(?:\s+|$)/i, ' ').trim();
        }

        // Check for animated prefix e.g. "animasi <delay?> <text>" or "animated <delay?> <text>"
        const animatedPrefixWithDelayRegex = /^(?:animasi|animated)\s+(\d{2,4})\s+(.+)$/i;
        const prefixDelayMatch = text.match(animatedPrefixWithDelayRegex);
        if (prefixDelayMatch) {
            isAnimated = true;
            const parsedDelay = parseInt(prefixDelayMatch[1], 10);
            if (!Number.isNaN(parsedDelay)) {
                delay = Math.min(Math.max(parsedDelay, MIN_DELAY), MAX_DELAY);
            }
            text = prefixDelayMatch[2].trim();
        } else {
            const animatedPrefixRegex = /^(?:animasi|animated)\s+(.+)$/i;
            const prefixMatch = text.match(animatedPrefixRegex);
            if (prefixMatch) {
                isAnimated = true;
                text = prefixMatch[1].trim();
            }
        }
    }

    if (forceStatic) {
        isAnimated = false;
    }

    return { text, isAnimated, delay, forceStatic };
}

/**
 * Fetches the Brat image/gif buffer from the API.
 */
export async function fetchBratMedia(text: string, isAnimated: boolean, delay = DEFAULT_DELAY): Promise<Buffer> {
    const params: Record<string, string | number | boolean> = {
        text,
        delay
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
    let delay = typeof args.delay === 'number' ? args.delay : DEFAULT_DELAY;

    const msg = ctx.msg;
    const rawMsgText = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();

    // Check if the command itself was triggered via .bratanimasi, .bratanimated, or "brat animasi", "brat animated"
    const firstTokens = rawMsgText.toLowerCase().replace(/^\./, '').split(/\s+/);
    const triggerWord = firstTokens[0] || '';
    const twoWordTrigger = firstTokens.slice(0, 2).join(' ');

    let commandIsAnimated = false;
    if (
        triggerWord === 'bratanimasi' ||
        triggerWord === 'bratanimated' ||
        twoWordTrigger === 'brat animasi' ||
        twoWordTrigger === 'brat animated'
    ) {
        commandIsAnimated = true;
        isAnimated = true;
    }

    if (!input) {
        // Try extracting text from the command message body
        if (rawMsgText) {
            const parts = rawMsgText.split(/\s+/);
            if (twoWordTrigger === 'brat animasi' || twoWordTrigger === 'brat animated') {
                input = parts.slice(2).join(' ').trim();
            } else if (triggerWord === 'brat' || triggerWord === 'bratanimasi' || triggerWord === 'bratanimated') {
                input = parts.slice(1).join(' ').trim();
            }
        }

        // If still empty or user only gave flags (e.g. .brat animasi without text), check if quoting a text message
        if (
            !input ||
            input === 'animasi' ||
            input === 'animated' ||
            input === '--animated' ||
            input === '--animasi' ||
            input === '-a'
        ) {
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quotedMsg) {
                const quotedText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
                if (quotedText.trim()) {
                    input = quotedText.trim();
                }
            }
        }
    }

    // Parse input for flags, dash delay, and disambiguation
    const parsed = parseBratInput(input, commandIsAnimated);
    input = parsed.text;
    if (parsed.isAnimated) {
        isAnimated = true;
    }
    if (parsed.forceStatic) {
        isAnimated = false;
    }
    if (parsed.delay !== DEFAULT_DELAY) {
        delay = parsed.delay;
    }

    // If input became empty after stripping prefix/flag (e.g. user typed ".brat animated -d 300" replying to a message)
    if (!input) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg) {
            const quotedText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
            if (quotedText.trim()) {
                input = quotedText.trim();
            }
        }
    }

    // If still no text provided, return comprehensive tutorial guide
    if (!input) {
        return ctx.t('media.brat.usage');
    }

    const senderCandidate = msg.key.participant || msg.key.remoteJid;
    const senderRaw = cleanId(senderCandidate) || '';
    const senderJid = senderRaw.length > 14 ? `${senderRaw}@lid` : `${senderRaw}@s.whatsapp.net`;

    try {
        await ctx.sock.sendMessage(ctx.jid, { react: { text: '⏳', key: msg.key } });

        const rawBuffer = await fetchBratMedia(input, isAnimated, delay);
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
