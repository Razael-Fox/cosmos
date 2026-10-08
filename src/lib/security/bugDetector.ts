import { WAMessage } from '@whiskeysockets/baileys';
import { isOwnerId } from '../owner.js';

export type MaliciousAttackType =
    'VIRTEX' | 'VCARD_CRASH' | 'STANZA_EXPLOSION' | 'RECURSIVE_QUOTE' | 'KENON_PAYLOAD' | 'TEXT_OVERFLOW';

export interface MaliciousDetectionResult {
    isMalicious: boolean;
    type?: MaliciousAttackType;
    reason?: string;
    severity?: 'WARNING' | 'BLOCKED';
    confidence: number;
}

// WhatsApp max normal protocol text size threshold
const MAX_RAW_TEXT_LENGTH = 65536;
const SUSPICIOUS_TEXT_LENGTH = 10000;

// Maximum acceptable non-photo VCard length
const MAX_VCARD_BODY_LENGTH = 10000;
const MAX_VCARD_RAW_LENGTH = 100000; // 100KB with base64 photos
const MAX_CONTACT_ARRAY_COUNT = 25;

// Maximum recursive quote traversal depth
const MAX_QUOTE_RECURSION_DEPTH = 3;

// Mention threshold for non-privileged users
const MAX_MENTIONS_THRESHOLD = 50;

/**
 * Checks a sample slice of text for invisible, zero-width, RTL overrides, and Zalgo diacritics.
 * Uses a single-pass character-code loop to prevent event loop blocking or ReDoS.
 */
function analyzeCharacterEntropy(text: string): {
    invisibleRatio: number;
    diacriticRatio: number;
    invisibleCount: number;
    diacriticCount: number;
} {
    if (!text || text.length === 0) {
        return { invisibleRatio: 0, diacriticRatio: 0, invisibleCount: 0, diacriticCount: 0 };
    }

    // Sample the text up to first 2,000 characters for high-speed linear scanning
    const sampleLength = Math.min(text.length, 2000);
    let invisibleCount = 0;
    let diacriticCount = 0;

    for (let i = 0; i < sampleLength; i++) {
        const code = text.charCodeAt(i);

        // Zero-width spaces, joiners, word-joiner, BOM: 0x200B-0x200F, 0x2060-0x206F, 0xFEFF
        // RTL / LTR direction overrides: 0x202A-0x202E
        if (
            (code >= 0x200b && code <= 0x200f) ||
            (code >= 0x202a && code <= 0x202e) ||
            (code >= 0x2060 && code <= 0x206f) ||
            code === 0xfeff
        ) {
            invisibleCount++;
            continue;
        }

        // Combining diacritical marks (Zalgo cascades):
        // 0x0300-0x036F, 0x1DC0-0x1DFF, 0x20D0-0x20FF, 0xFE20-0xFE2F
        if (
            (code >= 0x0300 && code <= 0x036f) ||
            (code >= 0x1dc0 && code <= 0x1dff) ||
            (code >= 0x20d0 && code <= 0x20ff) ||
            (code >= 0xfe20 && code <= 0xfe2f)
        ) {
            diacriticCount++;
        }
    }

    return {
        invisibleRatio: invisibleCount / sampleLength,
        diacriticRatio: diacriticCount / sampleLength,
        invisibleCount,
        diacriticCount
    };
}

/**
 * Strips base64 photo payloads from VCards before evaluating structural size.
 */
function stripVcardPhotos(vcard: string): string {
    return vcard.replace(/PHOTO[^:]*:[\s\S]*?(?=\r?\n[A-Z]+:|$)/gi, '');
}

interface QuotedContext {
    quotedMessage?: unknown;
}

/**
 * Checks for recursive quoted messages (contextInfo recursion trap).
 */
function checkQuoteRecursion(message: unknown): number {
    let depth = 0;
    let current: unknown = message;

    while (current && typeof current === 'object' && depth <= MAX_QUOTE_RECURSION_DEPTH + 1) {
        const obj = current as Record<string, unknown>;
        const extContext =
            obj.extendedTextMessage &&
            typeof obj.extendedTextMessage === 'object' &&
            'contextInfo' in obj.extendedTextMessage
                ? (obj.extendedTextMessage.contextInfo as QuotedContext | undefined)
                : undefined;
        const rootContext = 'contextInfo' in obj ? (obj.contextInfo as QuotedContext | undefined) : undefined;
        const quoted = extContext?.quotedMessage || rootContext?.quotedMessage;

        if (!quoted) break;
        depth++;
        current = quoted;
    }

    return depth;
}

/**
 * Known signatures of WhatsApp kenon / crash bait strings.
 */
const KENON_TRIGGER_SIGNATURES: string[] = [
    'wa.me/settings', // WhatsApp Android crash link vector
    'bancall-bot',
    'bug_kenon_crash_v',
    '#crash-wa',
    'wa.me/channel/crash'
];

export interface BugDetectorContext {
    isOwner?: boolean;
    isGroupAdmin?: boolean;
}

/**
 * Lightweight synchronous inspection of WAMessage for virtex, vcard bombs, and protocol crash traps.
 */
export function inspectMessageForMalice(msg: WAMessage, context?: BugDetectorContext): MaliciousDetectionResult {
    const rawMsg = msg.message;
    if (!rawMsg) {
        return { isMalicious: false, confidence: 0 };
    }

    const sender = msg.key.participant || msg.key.remoteJid;
    const isOwner = context?.isOwner ?? isOwnerId(sender);

    // Owners are completely exempt from payload limits
    if (isOwner) {
        return { isMalicious: false, confidence: 0 };
    }

    // 1. Text payload size & entropy inspection
    const text =
        rawMsg.conversation ||
        rawMsg.extendedTextMessage?.text ||
        rawMsg.imageMessage?.caption ||
        rawMsg.videoMessage?.caption ||
        rawMsg.documentMessage?.caption ||
        '';

    if (text.length > MAX_RAW_TEXT_LENGTH) {
        return {
            isMalicious: true,
            type: 'TEXT_OVERFLOW',
            reason: `Text payload length (${text.length}) exceeds protocol safety limit (${MAX_RAW_TEXT_LENGTH})`,
            severity: 'BLOCKED',
            confidence: 1.0
        };
    }

    if (text.length > SUSPICIOUS_TEXT_LENGTH) {
        const { invisibleRatio, diacriticRatio, invisibleCount } = analyzeCharacterEntropy(text);

        // More than 15% invisible/zero-width chars or > 120 invisible chars
        if (invisibleRatio > 0.15 || invisibleCount > 120) {
            return {
                isMalicious: true,
                type: 'VIRTEX',
                reason: `High density of zero-width or invisible control characters (${(invisibleRatio * 100).toFixed(1)}%, count: ${invisibleCount})`,
                severity: 'BLOCKED',
                confidence: 0.95
            };
        }

        // Zalgo cascade (> 40% combining diacritics in sample)
        if (diacriticRatio > 0.4) {
            return {
                isMalicious: true,
                type: 'VIRTEX',
                reason: `Excessive combining diacritical marks / Zalgo cascade (${(diacriticRatio * 100).toFixed(1)}%)`,
                severity: 'BLOCKED',
                confidence: 0.95
            };
        }
    } else if (text.length > 500) {
        // Shorter texts with overwhelming zero-width density
        const { invisibleRatio, invisibleCount } = analyzeCharacterEntropy(text);
        if (invisibleRatio > 0.3 || invisibleCount > 100) {
            return {
                isMalicious: true,
                type: 'VIRTEX',
                reason: `Anomalous invisible character density (${(invisibleRatio * 100).toFixed(1)}%, count: ${invisibleCount})`,
                severity: 'BLOCKED',
                confidence: 0.9
            };
        }
    }

    // 2. Kenon trigger / crash links
    if (text.length > 0 && text.length < 5000) {
        const lowerText = text.toLowerCase();
        for (const sig of KENON_TRIGGER_SIGNATURES) {
            if (lowerText.includes(sig)) {
                return {
                    isMalicious: true,
                    type: 'KENON_PAYLOAD',
                    reason: `Message contains known crash / kenon bait signature: "${sig}"`,
                    severity: 'BLOCKED',
                    confidence: 0.95
                };
            }
        }
    }

    // 3. VCard & Contact Payload Analysis
    if (rawMsg.contactMessage) {
        const vcard = rawMsg.contactMessage.vcard || '';
        if (vcard.length > MAX_VCARD_RAW_LENGTH) {
            return {
                isMalicious: true,
                type: 'VCARD_CRASH',
                reason: `Contact VCard raw size (${vcard.length} chars) exceeds maximum safety threshold (${MAX_VCARD_RAW_LENGTH})`,
                severity: 'BLOCKED',
                confidence: 1.0
            };
        }

        const stripped = stripVcardPhotos(vcard);
        if (stripped.length > MAX_VCARD_BODY_LENGTH) {
            return {
                isMalicious: true,
                type: 'VCARD_CRASH',
                reason: `Contact VCard structured body (${stripped.length} chars) exceeds safety threshold (${MAX_VCARD_BODY_LENGTH})`,
                severity: 'BLOCKED',
                confidence: 0.95
            };
        }
    }

    if (rawMsg.contactsArrayMessage) {
        const contacts = rawMsg.contactsArrayMessage.contacts || [];
        if (contacts.length > MAX_CONTACT_ARRAY_COUNT) {
            return {
                isMalicious: true,
                type: 'VCARD_CRASH',
                reason: `ContactsArray length (${contacts.length}) exceeds safety limit (${MAX_CONTACT_ARRAY_COUNT})`,
                severity: 'BLOCKED',
                confidence: 0.9
            };
        }

        let totalLength = 0;
        for (const c of contacts) {
            totalLength += (c.vcard || '').length;
        }

        if (totalLength > MAX_VCARD_RAW_LENGTH * 1.5) {
            return {
                isMalicious: true,
                type: 'VCARD_CRASH',
                reason: `Cumulative ContactsArray payload (${totalLength} chars) exceeds safety threshold`,
                severity: 'BLOCKED',
                confidence: 0.95
            };
        }
    }

    // 4. Stanza & Mention explosion
    let contextInfo: { mentionedJid?: string[] | null } | undefined;
    if (rawMsg.extendedTextMessage?.contextInfo) {
        contextInfo = rawMsg.extendedTextMessage.contextInfo;
    } else if (rawMsg.imageMessage?.contextInfo) {
        contextInfo = rawMsg.imageMessage.contextInfo;
    } else if (rawMsg.videoMessage?.contextInfo) {
        contextInfo = rawMsg.videoMessage.contextInfo;
    } else if ('contextInfo' in rawMsg && typeof rawMsg.contextInfo === 'object') {
        contextInfo = rawMsg.contextInfo as { mentionedJid?: string[] | null };
    }
    if (contextInfo) {
        const mentions = contextInfo.mentionedJid;
        if (Array.isArray(mentions) && mentions.length > MAX_MENTIONS_THRESHOLD) {
            // Group admins are allowed to mention many people (e.g. .hidetag or announcements)
            if (!context?.isGroupAdmin) {
                return {
                    isMalicious: true,
                    type: 'STANZA_EXPLOSION',
                    reason: `Unauthorized mention burst (${mentions.length} targets) from non-admin sender`,
                    severity: 'WARNING',
                    confidence: 0.85
                };
            }
        }

        // 5. Recursive quoted message trap
        const recursionDepth = checkQuoteRecursion(rawMsg);
        if (recursionDepth > MAX_QUOTE_RECURSION_DEPTH) {
            return {
                isMalicious: true,
                type: 'RECURSIVE_QUOTE',
                reason: `Quoted message recursion depth (${recursionDepth}) exceeds limit (${MAX_QUOTE_RECURSION_DEPTH})`,
                severity: 'BLOCKED',
                confidence: 0.95
            };
        }
    }

    return { isMalicious: false, confidence: 0 };
}
