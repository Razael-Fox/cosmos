import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import type { CountryCode } from 'libphonenumber-js/min';

export const COUNTRY_CODES: { iso: CountryCode; label: string }[] = [
    { iso: 'ID', label: 'ID (+62)' },
    { iso: 'US', label: 'US/CA (+1)' },
    { iso: 'GB', label: 'UK (+44)' },
    { iso: 'MY', label: 'MY (+60)' },
    { iso: 'SG', label: 'SG (+65)' },
    { iso: 'IN', label: 'IN (+91)' },
    { iso: 'AU', label: 'AU (+61)' },
    { iso: 'JP', label: 'JP (+81)' }
];

export interface ParsedPhone {
    /** E.164 digits without '+', used for JIDs and API payloads. */
    digits: string;
    /** Human-readable international format, shown as input confirmation. */
    international: string;
}

/**
 * Parse free-form user input into a validated phone number.
 * Accepts local format (0812...), IDD (0062...), or E.164 (+62...).
 * Returns null when the number is not valid.
 */
export function parsePhone(input: string, defaultCountry: CountryCode = 'ID'): ParsedPhone | null {
    // libphonenumber misreads a leading IDD '00' as national digits, so
    // normalize it to '+' first (0062... -> +62...).
    const sanitized = input.trim().replace(/^00/, '+');
    const parsed = parsePhoneNumberFromString(sanitized, defaultCountry);
    if (!parsed || !parsed.isValid()) return null;
    return {
        digits: parsed.number.replace(/\D/g, ''),
        international: parsed.formatInternational()
    };
}
