import { ToolModule, ToolContext } from './types.js';
import { getSessionByChatId } from '../utils/roulette.js';
import { getSenderJid, buildUserOrConditions, MIN_BET, MAX_BET } from '../utils/casino.js';
import { formatRupiah, parseCurrencyAmount } from '../utils/currency.js';
import { prisma } from '../db.js';
import { getTranslator } from '../utils/i18n.js';

const betTool: ToolModule = {
    definition: {
        name: 'bet',
        description: 'Place a bet for the Buckshot Roulette minigame',
        descriptionKey: 'tools.commands.bet.description',
        category: 'Games',
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Bet amount' }
            },
            required: ['input']
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const t = ctx?.t || getTranslator('en');
        const { msg, sock, jid } = ctx;
        const senderJid = getSenderJid(msg, sock);
        const user = await prisma.user.findFirst({ where: { OR: buildUserOrConditions(senderJid) } });
        const amount = parseCurrencyAmount(String(args.input || ''), user?.balance);

        if (amount === null || isNaN(amount) || amount < MIN_BET) {
            return t('games.roulette.min_bet', { min: formatRupiah(MIN_BET) });
        }

        if (amount > MAX_BET) {
            return t('games.roulette.max_bet', { max: formatRupiah(MAX_BET) });
        }

        const session = getSessionByChatId(jid);
        if (!session) {
            return t('games.roulette.no_session');
        }

        if (session.status !== 'LOBBY') {
            return t('games.roulette.bet_closed');
        }

        const player = session.players.find((p) => p.userId === senderJid);
        if (!player) {
            return t('games.roulette.bet_not_in_room', { sessionId: session.sessionId });
        }

        if (player.betAmount > 0) {
            return t('games.roulette.bet_already_placed');
        }

        // Deduct from DB
        if (!user || Number(user.balance) < amount) {
            return t('games.roulette.bet_insufficient', { balance: formatRupiah(user?.balance || 0) });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { balance: { decrement: amount } }
        });

        player.betAmount = amount;
        session.potAmount += amount;

        return t('games.roulette.bet_placed', {
            player: player.pushName,
            amount: formatRupiah(amount),
            pot: formatRupiah(session.potAmount)
        });
    }
};

export default betTool;
