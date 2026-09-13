import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid } from '../utils/casino.js';
import { getUser, parseBet, executeGamble, MIN_BET } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { chance } from '../utils/casino.js';
import { renderCard, renderSyntaxError, renderAlert } from '../utils/uiFormatter.js';

const DICE_EMOJIS = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

const diceTool: ToolModule = {
    definition: {
        name: 'dice',
        description: 'Play dice. Example: .dice 6 1.000.000',
        descriptionKey: 'tools.commands.dice.description',
        category: 'Casino',
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Your guess (1-6) and bet amount' }
            },
            required: ['input']
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const { msg, sock, jid } = ctx;
        const senderJid = getSenderJid(msg, sock);

        const pushName = msg.pushName || undefined;
        const user = await getUser(prisma, senderJid, pushName);

        const inputStr = String(args.input || '')
            .trim()
            .toLowerCase();

        const match = inputStr.match(/\b([1-6])\b/);
        const guess = match ? parseInt(match[1], 10) : null;

        if (!guess) {
            return renderSyntaxError(
                'dice',
                ctx.t('games.dice.guess_required'),
                '.dice <1-6> <bet_amount|all>',
                '.dice 6 50000\n• .dice 1 1.000.000\n• .dice 3 all',
                ctx.t
            );
        }

        const betStr = inputStr.replace(new RegExp(`\\b${guess}\\b`), '').trim();
        const bet = parseBet(betStr, Number(user.balance));

        if (bet === null) {
            return renderSyntaxError(
                'dice',
                ctx.t('games.dice.invalid_bet', { min: formatRupiah(MIN_BET) }),
                '.dice <1-6> <bet_amount|all>',
                '.dice 6 50000\n• .dice 1 1.000.000\n• .dice 3 all',
                ctx.t
            );
        }

        // Dice probabilities: 16% win, 84% lose. Multiplier: 5
        const result = await executeGamble(prisma, senderJid, bet, 5, 16, 84, sock, msg, 0, ctx.t);

        if (!result.success) {
            return renderAlert({ type: 'error', message: result.error! });
        }

        let rolled: number;
        if (result.isWin) {
            rolled = guess;
        } else {
            const possible = [1, 2, 3, 4, 5, 6].filter((n) => n !== guess);
            rolled = chance.pickone(possible);
        }

        const guessEmoji = `${DICE_EMOJIS[guess - 1]} [ ${guess} ]`;
        const rollEmoji = `${DICE_EMOJIS[rolled - 1]} [ ${rolled} ]`;

        const text = renderCard({
            title: 'HIGH STAKES DICE ROLL',
            icon: '🎲',
            headerStyle: 'light',
            fields: [
                { icon: '👤', label: 'Your Guess', value: guessEmoji },
                { icon: '🤖', label: 'House Roll', value: rollEmoji },
                {
                    icon: result.isWin ? '🎯' : '💀',
                    label: 'Match Result',
                    value: result.isWin ? 'Direct Hit (Win!)' : 'Missed (Lost)'
                },
                { icon: '💵', label: 'Wager', value: formatRupiah(bet) },
                {
                    icon: result.isWin ? '📈' : '💸',
                    label: result.isWin ? 'Payout (5x)' : 'Loss Incurred',
                    value: result.isWin ? `+${formatRupiah(result.winAmount)}` : `-${formatRupiah(bet)}`
                },
                { icon: '💰', label: 'Current Balance', value: formatRupiah(result.newBalance) }
            ]
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));
        await sock.sendMessage(jid, { text }, { quoted: msg });
    }
};

export default diceTool;
