import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid } from '../utils/casino.js';
import { getUser, parseBet, executeGamble, MIN_BET } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { chance } from '../utils/casino.js';

const SLOT_ITEMS = [
    { symbol: '🍒', multiplier: 2, bonus: 100000, weight: 50 },
    { symbol: '🍋', multiplier: 3, bonus: 200000, weight: 30 },
    { symbol: '🔔', multiplier: 5, bonus: 500000, weight: 12 },
    { symbol: '7️⃣', multiplier: 10, bonus: 1000000, weight: 6 },
    { symbol: '💎', multiplier: 20, bonus: 2000000, weight: 2 }
];

const slotTool: ToolModule = {
    definition: {
        name: 'slot',
        description: 'Play the slot machine. Example: .slot 1.000.000 or .slot all',
        descriptionKey: 'tools.commands.slot.description',
        category: 'Casino',
        parameters: {
            type: 'object',
            properties: {
                bet: { type: 'string', description: 'The amount of coins to bet' }
            },
            required: ['bet']
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const { msg, sock, jid } = ctx;
        const senderJid = getSenderJid(msg, sock);

        const pushName = msg.pushName || undefined;
        const user = await getUser(prisma, senderJid, pushName);

        const inputStr = String(args.bet || '').trim();
        if (!inputStr) {
            return ctx.t('games.slot.bet_required');
        }

        const bet = parseBet(inputStr, Number(user.balance));
        if (bet === null) {
            return ctx.t('games.slot.invalid_bet', { min: formatRupiah(MIN_BET) });
        }

        // Pre-roll the winning symbol to determine the multiplier
        const winItem = chance.weighted(
            SLOT_ITEMS,
            SLOT_ITEMS.map((item) => item.weight)
        );

        // Slot probabilities: 20% win, 80% lose
        const result = await executeGamble(
            prisma,
            senderJid,
            bet,
            winItem.multiplier,
            20,
            80,
            sock,
            msg,
            winItem.bonus,
            ctx.t
        );

        if (!result.success) {
            return `❌ ${result.error}`;
        }

        let slot1, slot2, slot3;
        const symbols = SLOT_ITEMS.map((item) => item.symbol);

        if (result.isWin) {
            slot1 = slot2 = slot3 = winItem.symbol;
        } else {
            slot1 = chance.pickone(symbols);
            slot2 = chance.pickone(symbols);
            do {
                slot3 = chance.pickone(symbols);
            } while (slot1 === slot2 && slot2 === slot3); // Ensure they don't match
        }

        const winMsg = result.isWin
            ? ctx.t('games.slot.jackpot', {
                  symbol: winItem.symbol,
                  multiplier: winItem.multiplier,
                  bonus: formatRupiah(winItem.bonus),
                  amount: formatRupiah(result.winAmount)
              })
            : ctx.t('games.slot.lost', { amount: formatRupiah(bet) });

        const text =
            `${ctx.t('games.slot.title')}\n\n` +
            `[ ${slot1} | ${slot2} | ${slot3} ]\n\n` +
            `${winMsg}\n` +
            `${ctx.t('games.slot.current_balance', { balance: formatRupiah(result.newBalance) })}`;

        await new Promise((resolve) => setTimeout(resolve, 3000));
        await sock.sendMessage(jid, { text }, { quoted: msg });
    }
};

export default slotTool;
