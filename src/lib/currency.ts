/**
 * Indonesian Rupiah (IDR) Currency Utility
 *
 * Implements local Indonesian currency convention:
 * - Symbol: `Rp` placed directly before the number (no space or optional compact format)
 * - Thousands separator: Period / dot (`.`)
 * - Decimal separator: Comma (`,`), with 0 decimals by default
 * - Standard locale: `id-ID`
 */

const numberFormatter = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
});

/**
 * Formats a number or bigint as local Indonesian Rupiah currency string.
 * Example: 1000000 -> "Rp1.000.000"
 */
export function formatRupiah(amount: number | bigint): string {
    const numeric = typeof amount === 'bigint' ? Number(amount) : amount;
    return `Rp${numberFormatter.format(numeric)}`;
}

/**
 * Formats a number with standard Indonesian thousands dot separator.
 * Example: 1000000 -> "1.000.000"
 */
export function formatNumberId(amount: number | bigint): string {
    const numeric = typeof amount === 'bigint' ? Number(amount) : amount;
    return numberFormatter.format(numeric);
}

/**
 * Parses user input into a valid integer currency amount.
 * Supports:
 * - Clean numbers ("10000", "1.000.000")
 * - Shorthand suffixes ("10k", "1m", "1jt", "1.5k", "2.5m")
 * - Special keywords: "all", "allin", "all-in" (resolves to current balance)
 */
export function parseCurrencyAmount(input: string, currentBalance?: number | bigint): number | null {
    const raw = String(input || '')
        .toLowerCase()
        .trim();
    if (!raw) return null;

    const balanceNum =
        currentBalance !== undefined
            ? typeof currentBalance === 'bigint'
                ? Number(currentBalance)
                : currentBalance
            : 0;

    if (raw === 'all' || raw === 'allin' || raw === 'all-in') {
        return balanceNum > 0 ? balanceNum : null;
    }

    // Strip "rp" prefix before processing shorthands
    const cleanedRaw = raw.replace(/^rp\.?\s*/, '').trim();

    // Handle "k" (thousands) - e.g. 10k, 1.5k, 500k
    const kMatch = cleanedRaw.match(/^([0-9]+(?:[.,][0-9]+)?)\s*k$/);
    if (kMatch) {
        const val = parseFloat(kMatch[1].replace(',', '.'));
        if (isNaN(val) || val <= 0) return null;
        return Math.floor(val * 1000);
    }

    // Handle "m" / "jt" / "juta" (millions) - e.g. 1m, 1.5m, 2jt
    const mMatch = cleanedRaw.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(?:m|jt|juta)$/);
    if (mMatch) {
        const val = parseFloat(mMatch[1].replace(',', '.'));
        if (isNaN(val) || val <= 0) return null;
        return Math.floor(val * 1000000);
    }

    // Handle standard dot thousands, comma thousands, and decimals (e.g. 1.000.000, 1.000.000,00, 10.000)
    let cleaned = cleanedRaw;

    // Check if input uses standard Indonesian local format: period as thousands separator (e.g., 1.000.000 or 1.000.000,50)
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
        cleaned = cleaned.replace(/\./g, '').replace(/,.*$/, '');
    }
    // Check if input uses international format: comma as thousands separator (e.g., 1,000,000 or 1,000,000.50)
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) {
        cleaned = cleaned.replace(/,/g, '').replace(/\..*$/, '');
    }
    // Fallback: strip dots if there are multiple dots or dot followed by 3 digits
    else {
        cleaned = cleaned.replace(/\./g, '').replace(/,.*$/, '').trim();
    }

    const parsed = parseInt(cleaned, 10);
    if (isNaN(parsed) || parsed <= 0) return null;
    return parsed;
}
