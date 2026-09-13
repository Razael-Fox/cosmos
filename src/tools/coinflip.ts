import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid } from '../utils/casino.js';
import { getUser, parseBet, executeGamble, MIN_BET } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { getTranslator } from '../utils/i18n.js';
import { renderCard, renderSyntaxError, renderAlert } from '../utils/uiFormatter.js';

const coinflipTool: ToolModule = {
    definition: {
        name: 'coinflip',
        description: 'Play coinflip. Example: .coinflip heads 1.000.000',
        descriptionKey: 'tools.commands.coinflip.description',
        category: 'Casino',
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Your guess (heads/tails) and bet amount' }
            },
            required: ['input']
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const t = ctx?.t || getTranslator('en');
        const { msg, sock, jid } = ctx;
        const senderJid = getSenderJid(msg, sock);

        const pushName = msg.pushName || undefined;
        const user = await getUser(prisma, senderJid, pushName);

        const inputStr = String(args.input || '')
            .trim()
            .toLowerCase();

        let guess = '';
        if (
            inputStr.includes('kepala') ||
            inputStr.includes('heads') ||
            inputStr.includes('head') ||
            inputStr.includes('h')
        ) {
            guess = 'heads';
        } else if (
            inputStr.includes('ekor') ||
            inputStr.includes('tails') ||
            inputStr.includes('tail') ||
            inputStr.includes('t')
        ) {
            guess = 'tails';
        }

        if (!guess) {
            return renderSyntaxError(
                'coinflip',
                t('games.coinflip.usage'),
                '.coinflip <heads|tails> <bet>',
                '.coinflip heads 50000\n• .coinflip tails 1.000.000\n• .coinflip heads all',
                t
            );
        }

        // Remove the guess word to parse the bet
        const betStr = inputStr.replace(/kepala|ekor|heads?|tails?|h|t/g, '').trim();
        const bet = parseBet(betStr, Number(user.balance));

        if (bet === null) {
            return renderSyntaxError(
                'coinflip',
                t('games.coinflip.min_bet', { min: formatRupiah(MIN_BET) }),
                '.coinflip <heads|tails> <bet>',
                '.coinflip heads 50000\n• .coinflip tails 1.000.000\n• .coinflip heads all',
                t
            );
        }

        // Coinflip probabilities: 30% win, 70% lose
        const result = await executeGamble(prisma, senderJid, bet, 2, 30, 70, sock, msg, 0, t);

        if (!result.success) {
            return renderAlert({ type: 'error', message: result.error! });
        }

        const flipped = result.isWin ? guess : guess === 'heads' ? 'tails' : 'heads';
        const flippedEmoji = flipped === 'heads' ? '🦅 Heads' : '🪙 Tails';

        const text = renderCard({
            title: 'COINFLIP ARENA',
            icon: '🪙',
            headerStyle: 'light',
            fields: [
                { icon: '👤', label: 'Your Guess', value: guess.toUpperCase() },
                { icon: '🎯', label: 'Landed Result', value: flippedEmoji },
                {
                    icon: result.isWin ? '🏆' : '💀',
                    label: 'Match Outcome',
                    value: result.isWin ? 'Direct Win!' : 'Defeat (Lost)'
                },
                { icon: '💵', label: 'Wager Placed', value: formatRupiah(bet) },
                {
                    icon: result.isWin ? '📈' : '💸',
                    label: result.isWin ? 'Payout (2x)' : 'Loss Incurred',
                    value: result.isWin ? `+${formatRupiah(result.winAmount)}` : `-${formatRupiah(bet)}`
                },
                { icon: '💰', label: 'Current Balance', value: formatRupiah(result.newBalance) }
            ]
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));
        await sock.sendMessage(jid, { text }, { quoted: msg });
    }
};

export default coinflipTool;
