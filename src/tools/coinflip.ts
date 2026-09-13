import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid } from '../utils/casino.js';
import { getUser, parseBet, executeGamble, MIN_BET } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { getTranslator } from '../utils/i18n.js';

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
            return `❌ ${t('games.coinflip.usage')}`;
        }

        // Remove the guess word to parse the bet
        const betStr = inputStr.replace(/kepala|ekor|heads?|tails?|h|t/g, '').trim();
        const bet = parseBet(betStr, Number(user.balance));

        if (bet === null) {
            return `❌ ${t('games.coinflip.min_bet', { min: formatRupiah(MIN_BET) })}`;
        }

        // Coinflip probabilities: 30% win, 70% lose
        const result = await executeGamble(prisma, senderJid, bet, 2, 30, 70, sock, msg, 0, t);

        if (!result.success) {
            return `❌ ${result.error}`;
        }

        const flipped = result.isWin ? guess : guess === 'heads' ? 'tails' : 'heads';
        const flippedEmoji = flipped === 'heads' ? '🦅 (Heads)' : '🪙 (Tails)';

        const winMsg = result.isWin
            ? `🎉 ${t('games.coinflip.win_earned', { amount: formatRupiah(result.winAmount) })}`
            : `💀 ${t('games.coinflip.lose_lost', { amount: formatRupiah(bet) })}`;

        const text =
            `${t('games.coinflip.title')}\n\n` +
            `${t('games.coinflip.guessed', { guess: guess.toUpperCase() })}\n` +
            `${t('games.coinflip.landed', { result: flippedEmoji })}\n\n` +
            `${winMsg}\n` +
            `${t('games.coinflip.current_balance', { balance: formatRupiah(result.newBalance) })}`;

        await new Promise((resolve) => setTimeout(resolve, 3000));
        await sock.sendMessage(jid, { text }, { quoted: msg });
    }
};

export default coinflipTool;
