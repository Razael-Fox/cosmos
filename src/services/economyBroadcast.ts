import { WASocket } from '@whiskeysockets/baileys';
import { formatRupiah } from '../utils/currency.js';
import { getTranslator } from '../utils/i18n.js';

export function renderForexBroadcast(multiplier: number, reasoning: string, rate: number, lang: string = 'id'): string {
    const t = getTranslator(lang);
    return (
        `${t('tools.broadcast.forex_title')}\n\n` +
        `${t('tools.broadcast.forex_rate', { rate: formatRupiah(rate) })}\n` +
        `${t('tools.broadcast.forex_trend')}\n\n` +
        `${t('tools.broadcast.forex_adjustments_title')}\n` +
        `• ${t('tools.broadcast.forex_inflation', { multiplier: `${multiplier}x` })}\n` +
        `• ${t('tools.broadcast.forex_shop_loot')}\n\n` +
        `_${t('tools.broadcast.forex_ai_note', { reasoning })}_`
    );
}

export async function broadcastEconomicUpdate(sock: WASocket, multiplier: number, reasoning: string, rate: number) {
    // Defer DB import to avoid top-level schema check during static tests / host environments
    const { prisma } = await import('../db.js');
    const groups = await prisma.whitelistedGroup.findMany();

    for (const group of groups) {
        const lang = group.language || 'id';
        const message = renderForexBroadcast(multiplier, reasoning, rate, lang);
        await sock.sendMessage(group.jid, { text: message });
    }

    try {
        const { broadcastSubBotForex } = await import('#services/subBotService.js');
        await broadcastSubBotForex(multiplier, reasoning, rate);
    } catch (err) {
        console.error('[FOREX Broadcast] Error broadcasting to sub-bots:', err);
    }
}
