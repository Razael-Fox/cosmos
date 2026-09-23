import { WASocket } from '@whiskeysockets/baileys';
import { gameSessions, handleElimination, nextTurn, checkReloadShells, formatRouletteItem } from './roulette.js';
import { formatRupiah } from './currency.js';
import { prisma } from '../db.js';
import { getChatLanguage, getTranslator } from './i18n.js';

let afkInterval: NodeJS.Timeout | null = null;

export function initRouletteAfkTimer(sock: WASocket) {
    if (afkInterval) {
        clearInterval(afkInterval);
    }

    // Check every 5 seconds
    afkInterval = setInterval(async () => {
        const now = Date.now();
        for (const [sessionId, session] of gameSessions.entries()) {
            if (session.status !== 'PLAYING') continue;

            // If 60 seconds have passed since lastActionAt
            if (now - session.lastActionAt > 60000) {
                const currentPlayer = session.players[session.turnIndex];

                // Set HP to 0 and AFK status
                currentPlayer.hp = 0;
                currentPlayer.isAfk = true;

                // Increase rouletteAfk penalty in DB
                try {
                    await prisma.user.update({
                        where: { id: currentPlayer.userId },
                        data: { rouletteAfk: { increment: 1 } }
                    });
                } catch (err) {
                    console.error('Failed to update AFK penalty:', err);
                }

                const lang = await getChatLanguage(session.chatId);
                const t = getTranslator(lang);

                let outputMsg = t('games.roulette.afk_timeout', {
                    player: currentPlayer.userId.split('@')[0]
                });

                outputMsg += handleElimination(session, currentPlayer, t);

                // Check if only 1 player is left
                const alivePlayers = session.players.filter((p) => p.hp > 0);
                if (alivePlayers.length === 1) {
                    const winner = alivePlayers[0];
                    session.status = 'FINISHED';

                    const pot = session.potAmount;

                    try {
                        await prisma.user.update({
                            where: { id: winner.userId },
                            data: { balance: { increment: pot }, rouletteWins: { increment: 1 } }
                        });

                        for (const p of session.players) {
                            await prisma.user.update({
                                where: { id: p.userId },
                                data: { rouletteRounds: { increment: 1 } }
                            });
                        }
                    } catch (err) {
                        console.error('Failed to update winner stats:', err);
                    }

                    outputMsg += t('games.roulette.game_over_winner', {
                        winner: winner.userId.split('@')[0],
                        pot: formatRupiah(pot)
                    });

                    gameSessions.delete(sessionId);
                } else {
                    // Turn passes since player was kicked
                    outputMsg += nextTurn(session, true, t); // Randomize next turn when someone dies

                    const reloadMsg = checkReloadShells(session, t);
                    if (reloadMsg) {
                        outputMsg += `\n${reloadMsg}`;
                        const nextP = session.players[session.turnIndex];
                        const inventoryStr =
                            nextP.inventory.length > 0
                                ? nextP.inventory.map((i) => formatRouletteItem(i, t)).join(', ')
                                : t('games.roulette.inventory_empty');
                        outputMsg += t('games.roulette.turn_info', {
                            player: nextP.userId.split('@')[0],
                            lives: `${'❤️'.repeat(nextP.hp)}${'🖤'.repeat(5 - nextP.hp)}`,
                            inventory: inventoryStr
                        });
                    }
                }

                const mentions = session.players.map((p) => p.userId);
                try {
                    await sock.sendMessage(session.chatId, { text: outputMsg, mentions });
                } catch (err) {
                    console.error('Failed to send AFK message:', err);
                }

                // Update lastActionAt so we don't spam if something goes wrong
                session.lastActionAt = Date.now();
            }
        }
    }, 5000);
}
