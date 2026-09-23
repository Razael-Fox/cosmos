import { ToolModule, ToolContext } from './types.js';
import { gameSessions, getSessionByChatId, handleElimination, nextTurn, checkReloadShells } from '../utils/roulette.js';
import { getSenderJid, resolveId } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { prisma } from '../db.js';
import { getTranslator } from '../utils/i18n.js';
import { renderHealthGauge } from '../utils/uiFormatter.js';

const shootTool: ToolModule = {
    definition: {
        name: 'shoot',
        description: 'Shoot a player or yourself in Buckshot Roulette',
        descriptionKey: 'tools.commands.shoot.description',
        category: 'Games',
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Target player tag or "me"' }
            },
            required: ['input']
        }
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const t = ctx?.t || getTranslator('en');
        const { msg, sock, jid } = ctx;
        const senderJid = getSenderJid(msg, sock);
        const inputStr = String(args.input || '')
            .trim()
            .toLowerCase();

        const session = getSessionByChatId(jid);
        if (!session || session.status !== 'PLAYING') {
            return t('games.roulette.no_session');
        }

        const currentPlayer = session.players[session.turnIndex];
        if (currentPlayer.userId !== senderJid) {
            return t('games.roulette.not_your_turn');
        }

        let targetId = '';
        if (inputStr === 'me') {
            targetId = senderJid;
        } else {
            const mentionedJidList = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentionedJidList.length > 0) {
                targetId = await resolveId(mentionedJidList[0], sock, msg.key.remoteJid);
            } else {
                return t('games.roulette.specify_target');
            }
        }

        const target = session.players.find((p) => p.userId === targetId);
        if (!target || target.hp <= 0) {
            return t('games.roulette.invalid_target');
        }

        const currentShell = session.shells.pop(); // Remove front shell
        const isSelfShoot = senderJid === targetId;
        const damage = currentPlayer.handSawActive ? 2 : 1;
        let targetEliminated = false;

        currentPlayer.handSawActive = false;
        session.lastActionAt = Date.now();

        let outputMsg = t('games.roulette.aim_message', {
            shooter: currentPlayer.pushName,
            target: target.pushName
        });

        await sock.sendMessage(jid, { text: outputMsg, mentions: [senderJid, targetId] });
        await new Promise((resolve) => setTimeout(resolve, 2000));

        outputMsg = ''; // Reset for the result

        if (currentShell === 'LIVE') {
            outputMsg += t('games.roulette.bang_live');
            target.hp -= damage;

            if (target.hp <= 0) {
                targetEliminated = true;
                outputMsg += handleElimination(session, target, t);
            }

            outputMsg += nextTurn(session, targetEliminated, t);
        } else {
            outputMsg += t('games.roulette.click_blank', { target: target.pushName });

            if (isSelfShoot) {
                outputMsg += t('games.roulette.turn_continues_self');
            } else {
                outputMsg += nextTurn(session, false, t);
            }
        }

        outputMsg += t('games.roulette.remaining_shells', { count: session.shells.length });

        // Check game over
        const alivePlayers = session.players.filter((p) => p.hp > 0);
        if (alivePlayers.length === 1) {
            const winner = alivePlayers[0];
            session.status = 'FINISHED';

            // Update stats
            const pot = session.potAmount;

            // Give money to winner
            await prisma.user.update({
                where: { id: winner.userId },
                data: { balance: { increment: pot }, rouletteWins: { increment: 1 } }
            });

            // Update matches played for all
            for (const p of session.players) {
                await prisma.user.update({
                    where: { id: p.userId },
                    data: { rouletteRounds: { increment: 1 } }
                });
            }

            outputMsg += t('games.roulette.game_over_winner', {
                winner: winner.pushName,
                pot: formatRupiah(pot)
            });

            gameSessions.delete(session.sessionId);
        } else {
            const reloadMsg = checkReloadShells(session, t);
            if (reloadMsg) {
                outputMsg += `\n${reloadMsg}`;
                // After reload, we need to show the next turn info again because it might have gotten buried
                const nextP = session.players[session.turnIndex];
                const formatItem = (item: string) => {
                    switch (item) {
                        case 'COLA':
                            return t('games.roulette.item_cola');
                        case 'CIGARETTES':
                            return t('games.roulette.item_cigarettes');
                        case 'HAND_SAW':
                            return t('games.roulette.item_hand_saw');
                        case 'HANDCUFFS':
                            return t('games.roulette.item_handcuffs');
                        case 'MAGNIFYING_GLASS':
                            return t('games.roulette.item_magnifying_glass');
                        case 'INVERTER':
                            return t('games.roulette.item_inverter');
                        default:
                            return item.replace('_', ' ');
                    }
                };
                const inventoryStr =
                    nextP.inventory.length > 0
                        ? nextP.inventory.map(formatItem).join(', ')
                        : t('games.roulette.inventory_empty');
                outputMsg += t('games.roulette.turn_info', {
                    player: nextP.pushName,
                    lives: renderHealthGauge(nextP.hp, 5, t),
                    inventory: inventoryStr
                });
            }
        }

        const mentions = session.players.map((p) => p.userId);
        await sock.sendMessage(jid, { text: outputMsg, mentions });
        return null;
    }
};

export default shootTool;
