/**
 * Rupiah currency formatting utility adhering to standard Indonesian format:
 * "Rp tanpa spasi, pemisah ribuan titik, tanpa desimal" (e.g. Rp0, Rp10.000, Rp32.000).
 */
export function formatRupiah(amount: number | bigint): string {
    const numericVal = typeof amount === 'bigint' ? Number(amount) : amount;
    if (isNaN(numericVal)) return 'Rp0';
    const rounded = Math.floor(Math.abs(numericVal));
    const formatted = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return numericVal < 0 ? `-Rp${formatted}` : `Rp${formatted}`;
}
