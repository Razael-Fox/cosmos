import { formatRupiah } from './currency.js';

export function formatCurrency(amount: number | bigint): string {
    return formatRupiah(amount);
}

export function formatNumber(num: number | bigint, lang: 'id' | 'en' = 'id'): string {
    const localeMap = { id: 'id-ID', en: 'en-US' } as const;
    const numeric = typeof num === 'bigint' ? Number(num) : num;
    return new Intl.NumberFormat(localeMap[lang] || 'id-ID').format(numeric);
}

export function formatDate(date: Date, lang: 'id' | 'en' = 'id'): string {
    const localeMap = { id: 'id-ID', en: 'en-US' } as const;
    return new Intl.DateTimeFormat(localeMap[lang] || 'id-ID', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }).format(date);
}
