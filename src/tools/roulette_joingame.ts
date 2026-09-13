import { ToolModule, ToolContext } from './types.js';
import { gameSessions, Player } from '../utils/roulette.js';
import { getSenderJid, MIN_BET } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { prisma } from '../db.js';
import { getTranslator } from '../utils/i18n.js';
import { renderCard } from '../utils/uiFormatter.js';

const joinGameTool: ToolModule = {
    definition: {
        name: 'joingame',
        description: 'Join a Buckshot Roulette minigame session',
        descriptionKey: 'tools.commands.joingame.description',
        category: 'Games',
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Session ID to join' }
            },
            required: ['input']
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const t = ctx?.t || getTranslator('en');
        const { msg, sock } = ctx;
        const senderJid = getSenderJid(msg, sock);
        const sessionId = String(args.input || '')
            .trim()
            .toUpperCase();

        if (!sessionId) {
            return t('games.roulette.session_id_required');
        }

        const session = gameSessions.get(sessionId);
        if (!session) {
            return t('games.roulette.session_not_found');
        }

        if (session.status !== 'LOBBY') {
            return t('games.roulette.already_started');
        }

        if (session.players.length >= 5) {
            return t('games.roulette.room_full');
        }

        const user = await prisma.user.findFirst({
            where: {
                OR: [{ id: senderJid }, { lid: senderJid }]
            }
        });
        const actualUserId = user ? user.id : senderJid;

        if (session.players.find((p) => p.userId === actualUserId || p.userId === senderJid)) {
            return t('games.roulette.already_joined');
        }

        const newPlayer: Player = {
            userId: actualUserId,
            pushName: msg.pushName || senderJid.split('@')[0],
            hp: 5,
            inventory: [],
            betAmount: 0,
            isHandcuffed: false,
            hasUsedItemThisTurn: false,
            handSawActive: false,
            isAfk: false
        };

        session.players.push(newPlayer);

        const numPlayers = session.players.length;

        return renderCard({
            title: 'BUCKSHOT ROULETTE LOBBY',
            icon: '🔫',
            headerStyle: 'bold',
            sections: [
                {
                    title: `ACTIVE ROSTER (${numPlayers}/5 PLAYERS)`,
                    items: session.players.map((p, idx) => ({
                        label: `${idx === 0 ? '👑 ' : ''}@${p.pushName}`,
                        value: p.betAmount > 0 ? formatRupiah(p.betAmount) : 'No Bet'
                    }))
                },
                {
                    title: 'PRIZE POT',
                    items: [
                        { label: 'Current Pot', value: formatRupiah(session.potAmount) },
                        { label: 'Minimum Bet', value: formatRupiah(MIN_BET) }
                    ]
                }
            ],
            tip: 'Place bet with .bet <amount> • Host starts with .startgame'
        });
    }
};

export default joinGameTool;
