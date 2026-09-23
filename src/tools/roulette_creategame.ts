import { ToolModule, ToolContext } from './types.js';
import { gameSessions, generateSessionId, Player } from '../utils/roulette.js';
import { getSenderJid } from '../utils/casino.js';
import { prisma } from '../db.js';
import { registerCancellableSession, unregisterCancellableSession } from '../utils/cancellationManager.js';
import { getTranslator } from '../utils/i18n.js';
import { renderCard } from '../utils/uiFormatter.js';

const createGameTool: ToolModule = {
    definition: {
        name: 'creategame',
        description: 'Create a new Buckshot Roulette minigame session',
        descriptionKey: 'tools.commands.creategame.description',
        category: 'Games'
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const t = ctx?.t || getTranslator('en');
        const { msg, sock, jid } = ctx;
        const senderJid = getSenderJid(msg, sock);

        // Check if there is already a game in this group
        for (const session of gameSessions.values()) {
            if (session.chatId === jid) {
                return t('games.roulette.already_ongoing', { sessionId: session.sessionId });
            }
        }

        const sessionId = generateSessionId();
        const timeoutId = setTimeout(async () => {
            const session = gameSessions.get(sessionId);
            if (session && session.status === 'LOBBY' && session.players.length < 2) {
                unregisterCancellableSession(`roulette_${sessionId}`);
                gameSessions.delete(sessionId);
                await sock.sendMessage(jid, {
                    text: t('games.roulette.cancelled_timeout')
                });
            }
        }, 30000);

        const creator: Player = {
            userId: senderJid,
            pushName: msg.pushName || senderJid.split('@')[0],
            hp: 5,
            inventory: [],
            betAmount: 0,
            isHandcuffed: false,
            hasUsedItemThisTurn: false,
            handSawActive: false,
            isAfk: false
        };

        gameSessions.set(sessionId, {
            sessionId,
            chatId: jid,
            status: 'LOBBY',
            players: [creator],
            potAmount: 0,
            turnIndex: 0,
            shells: [],
            createdAt: Date.now(),
            lastActionAt: Date.now(),
            timeoutId
        });

        registerCancellableSession({
            sessionId: `roulette_${sessionId}`,
            feature: 'roulette',
            userJid: senderJid,
            chatJid: jid,
            description: t('games.roulette.cancellation_desc'),
            onCancel: async () => {
                const session = gameSessions.get(sessionId);
                if (session && session.status === 'LOBBY') {
                    if (session.timeoutId) {
                        clearTimeout(session.timeoutId);
                    }
                    gameSessions.delete(sessionId);
                    for (const player of session.players) {
                        if (player.betAmount > 0) {
                            try {
                                await prisma.user.update({
                                    where: { id: player.userId },
                                    data: { balance: { increment: BigInt(player.betAmount) } }
                                });
                            } catch {
                                // ignore
                            }
                        }
                    }
                    return t('games.roulette.cancelled_host', { sessionId });
                }
            }
        });

        return renderCard({
            title: t('games.roulette.card_title_lobby'),
            icon: '🔫',
            headerStyle: 'bold',
            subtitle: t('games.roulette.subtitle_created'),
            t,
            sections: [
                {
                    title: t('games.roulette.lobby_info_title'),
                    items: [
                        { label: t('games.roulette.label_host'), value: `@${creator.pushName}` },
                        { label: t('games.roulette.label_session_id'), value: `\`${sessionId}\`` },
                        {
                            label: t('games.roulette.label_status'),
                            value: t('games.roulette.status_waiting_players', { current: 1 })
                        },
                        { label: t('games.roulette.label_timeout'), value: t('games.roulette.timeout_duration') }
                    ]
                }
            ],
            tip: t('games.roulette.tip_create', { sessionId })
        });
    }
};

export default createGameTool;
