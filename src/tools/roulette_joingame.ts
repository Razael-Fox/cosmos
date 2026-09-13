import { ToolModule, ToolContext } from './types.js';
import { gameSessions, Player } from '../utils/roulette.js';
import { getSenderJid, MIN_BET } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { prisma } from '../db.js';
import { getTranslator } from '../utils/i18n.js';

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
        const roundCount = user?.rouletteRounds || 0;
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

        const creator = session.players[0];
        const creatorData = await prisma.user.findFirst({
            where: {
                OR: [{ id: creator.userId }, { lid: creator.userId }]
            }
        });
        const creatorRounds = creatorData?.rouletteRounds || 0;

        let playerList = '';
        session.players.forEach((p, idx) => {
            const prefix = idx === 0 ? '👑 ' : '';
            const rounds = idx === 0 ? creatorRounds : p.userId === actualUserId ? roundCount : 0; // Quick hack to show rounds
            playerList += `${idx + 1}. ${prefix}@${p.pushName} (${rounds} Rounds)\n`;
        });

        const numPlayers = session.players.length;
        const betters = session.players.filter((p) => p.betAmount > 0).length;

        return t('games.roulette.joined_broadcast', {
            player: newPlayer.pushName,
            count: numPlayers,
            players: playerList.trim(),
            pot: formatRupiah(session.potAmount),
            betters,
            plural: betters > 1 ? 's' : '',
            min: formatRupiah(MIN_BET)
        });
    }
};

export default joinGameTool;
