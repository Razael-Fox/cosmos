/**
 * Global utility for extracting and handling WhatsApp monospace-delimited text
 * and string literal enclosures from user message parameters.
 *
 * WhatsApp supports formatting text in monospace using triple backticks (```text```)
 * or single inline backticks (`text`). Users often use this formatting or standard
 * quotes ("text", 'text') to encapsulate parameters that contain spaces or literal
 * keywords (e.g. .contact add `Ls Friends` 123456789 or .brat ```animasi keren```).
 */

export interface MonospaceExtractionResult {
    /** Whether an enclosed or monospace segment was detected and extracted */
    matched: boolean;
    /** The extracted inner text with delimiters removed and whitespace trimmed */
    extracted: string;
    /** The remaining string after the extracted segment (trimmed) */
    remainder: string;
    /** The delimiter type detected ('triple-backtick' | 'single-backtick' | 'double-quote' | 'single-quote' | 'none') */
    delimiter: 'triple-backtick' | 'single-backtick' | 'double-quote' | 'single-quote' | 'none';
}

/**
 * Extracts a leading monospace or quoted block from an input string.
 *
 * Priority order:
 * 1. Triple backticks (WhatsApp standard monospace block): ```...```
 * 2. Single backticks (WhatsApp inline monospace): `...`
 * 3. Double quotes: "..."
 * 4. Single quotes: '...'
 *
 * @param input The raw parameter string
 * @returns MonospaceExtractionResult with the extracted segment and remainder
 */
export function extractLeadingMonospace(input: string): MonospaceExtractionResult {
    const trimmed = input.trim();
    if (!trimmed) {
        return { matched: false, extracted: '', remainder: '', delimiter: 'none' };
    }

    // Regex matching leading enclosed string: ```...```, `...`, "...", '...'
    const match = trimmed.match(/^(?:```([\s\S]+?)```|`([^`]+)`|"([^"]+)"|'([^']+)')(?:\s*([\s\S]*))?$/);
    if (match) {
        let delimiter: MonospaceExtractionResult['delimiter'] = 'none';
        let extracted = '';

        if (match[1] !== undefined) {
            delimiter = 'triple-backtick';
            extracted = match[1];
        } else if (match[2] !== undefined) {
            delimiter = 'single-backtick';
            extracted = match[2];
        } else if (match[3] !== undefined) {
            delimiter = 'double-quote';
            extracted = match[3];
        } else if (match[4] !== undefined) {
            delimiter = 'single-quote';
            extracted = match[4];
        }

        const remainder = (match[5] || '').trim();
        return {
            matched: true,
            extracted: extracted.trim(),
            remainder,
            delimiter
        };
    }

    return {
        matched: false,
        extracted: '',
        remainder: trimmed,
        delimiter: 'none'
    };
}

/**
 * Unwraps an entire string if it is enclosed by WhatsApp monospace or quotes.
 * If the string is enclosed, returns the inner content and unwrap status.
 *
 * @param input The raw input string
 * @returns An object with the unwrapped text and whether it was wrapped
 */
export function unwrapMonospace(input: string): {
    text: string;
    wasWrapped: boolean;
    delimiter: MonospaceExtractionResult['delimiter'];
} {
    const trimmed = input.trim();
    const match = trimmed.match(/^(?:```([\s\S]+?)```|`([^`]+)`|"([^"]+)"|'([^']+)')$/);
    if (match) {
        let delimiter: MonospaceExtractionResult['delimiter'] = 'none';
        let inner = '';

        if (match[1] !== undefined) {
            delimiter = 'triple-backtick';
            inner = match[1];
        } else if (match[2] !== undefined) {
            delimiter = 'single-backtick';
            inner = match[2];
        } else if (match[3] !== undefined) {
            delimiter = 'double-quote';
            inner = match[3];
        } else if (match[4] !== undefined) {
            delimiter = 'single-quote';
            inner = match[4];
        }

        return {
            text: inner.trim(),
            wasWrapped: true,
            delimiter
        };
    }

    return {
        text: trimmed,
        wasWrapped: false,
        delimiter: 'none'
    };
}

/**
 * Checks if a string starts with or is wrapped in WhatsApp monospace backticks (` or ```).
 */
export function isMonospaceWrapped(input: string): boolean {
    const trimmed = input.trim();
    return (
        (trimmed.startsWith('```') && trimmed.endsWith('```') && trimmed.length >= 6) ||
        (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2)
    );
}
