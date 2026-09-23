import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid } from '../utils/casino.js';
import { getUser, parseBet, executeGamble, MIN_BET } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { chance } from '../utils/casino.js';
import { renderCard, renderSyntaxError, renderAlert, CardField } from '../utils/uiFormatter.js';

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
            return renderSyntaxError(
                'slot',
                ctx.t('games.slot.bet_required'),
                '.slot <bet_amount|all>',
                '.slot 50000\n• .slot 1.000.000\n• .slot all',
                ctx.t
            );
        }

        const bet = parseBet(inputStr, Number(user.balance));
        if (bet === null) {
            return renderSyntaxError(
                'slot',
                ctx.t('games.slot.invalid_bet', { min: formatRupiah(MIN_BET) }),
                '.slot <bet_amount|all>',
                '.slot 50000\n• .slot 1.000.000\n• .slot all',
                ctx.t
            );
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
            return renderAlert({ type: 'error', message: result.error! });
        }

        let slot1: string;
        let slot2: string;
        let slot3: string;
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

        const slotBox = [
            '     ╭───────────────╮',
            `     │  ${slot1} │ ${slot2} │ ${slot3}  │${result.isWin ? ` ◄ [ ${ctx.t('games.slot.jackpot_tag')} ]` : ''}`,
            '     ╰───────────────╯'
        ].join('\n');

        const fields: CardField[] = [];
        if (result.isWin) {
            fields.push(
                {
                    icon: '🏆',
                    label: ctx.t('games.slot.label_result'),
                    value: ctx.t('games.slot.win_result', {
                        symbol: winItem.symbol,
                        multiplier: winItem.multiplier,
                        bonus: formatRupiah(winItem.bonus)
                    })
                },
                { icon: '💵', label: ctx.t('games.slot.label_bet_placed'), value: formatRupiah(bet) },
                {
                    icon: '🎉',
                    label: ctx.t('games.slot.label_payout_won'),
                    value: `+${formatRupiah(result.winAmount)}`
                },
                { icon: '💰', label: ctx.t('games.slot.label_new_balance'), value: formatRupiah(result.newBalance) }
            );
        } else {
            fields.push(
                { icon: '❌', label: ctx.t('games.slot.label_result'), value: ctx.t('games.slot.no_match') },
                { icon: '💵', label: ctx.t('games.slot.label_bet_placed'), value: formatRupiah(bet) },
                { icon: '💸', label: ctx.t('games.slot.label_loss_amount'), value: `-${formatRupiah(bet)}` },
                { icon: '💰', label: ctx.t('games.slot.label_new_balance'), value: formatRupiah(result.newBalance) }
            );
        }

        const text = renderCard({
            title: ctx.t('games.slot.card_title'),
            icon: '🎰',
            headerStyle: 'heavy',
            t: ctx.t,
            body: ['', slotBox, ''],
            fields
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));
        await sock.sendMessage(jid, { text }, { quoted: msg });
    }
};

export default slotTool;
