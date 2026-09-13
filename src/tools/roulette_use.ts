import { ToolModule, ToolContext } from './types.js';
import { getSessionByChatId, ItemType } from '../utils/roulette.js';
import { getSenderJid, resolveId } from '../utils/casino.js';
import { getTranslator } from '../utils/i18n.js';
import { renderHealthGauge } from '../utils/uiFormatter.js';

const useTool: ToolModule = {
    definition: {
        name: 'use',
        description: 'Use an item in Buckshot Roulette',
        descriptionKey: 'tools.commands.use.description',
        category: 'Games',
        parameters: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Item name and target (if applicable)' }
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

        if (currentPlayer.hasUsedItemThisTurn) {
            return t('games.roulette.already_used_item');
        }

        let targetId = '';

        const mentionedJidList = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentionedJidList.length > 0) {
            targetId = await resolveId(mentionedJidList[0], sock, msg.key.remoteJid);
        }

        let itemType: ItemType | undefined;
        if (inputStr.includes('cola') || inputStr.includes('beer')) itemType = 'COLA';
        else if (inputStr.includes('magnifying') || inputStr.includes('glass')) itemType = 'MAGNIFYING_GLASS';
        else if (inputStr.includes('saw') || inputStr.includes('handsaw')) itemType = 'HAND_SAW';
        else if (inputStr.includes('handcuff') || inputStr.includes('cuff')) itemType = 'HANDCUFFS';
        else if (inputStr.includes('cigarette') || inputStr.includes('cigar')) itemType = 'CIGARETTES';
        else if (inputStr.includes('inverter')) itemType = 'INVERTER';

        if (!itemType) {
            return t('games.roulette.invalid_item');
        }

        const itemIndex = currentPlayer.inventory.indexOf(itemType);
        if (itemIndex === -1) {
            return t('games.roulette.item_not_in_inventory');
        }

        currentPlayer.inventory.splice(itemIndex, 1);
        currentPlayer.hasUsedItemThisTurn = true;
        session.lastActionAt = Date.now();

        let outputMsg = '';

        switch (itemType) {
            case 'COLA':
            case 'CIGARETTES':
                if (currentPlayer.hp < 5) currentPlayer.hp++;
                outputMsg = t('games.roulette.used_heal', {
                    player: currentPlayer.pushName,
                    item: itemType === 'COLA' ? 'Cola' : 'Cigarettes',
                    lives: renderHealthGauge(currentPlayer.hp, 5)
                });
                break;
            case 'HAND_SAW':
                currentPlayer.handSawActive = true;
                outputMsg = t('games.roulette.used_saw', { player: currentPlayer.pushName });
                break;
            case 'HANDCUFFS': {
                if (!targetId) return t('games.roulette.handcuffs_usage');
                const target = session.players.find((p) => p.userId === targetId);
                if (target && target.hp > 0) {
                    target.isHandcuffed = true;
                    outputMsg = t('games.roulette.used_handcuffs', {
                        player: currentPlayer.pushName,
                        target: target.pushName
                    });
                } else {
                    return t('games.roulette.invalid_target');
                }
                break;
            }
            case 'MAGNIFYING_GLASS': {
                outputMsg = t('games.roulette.used_glass', { player: currentPlayer.pushName });
                await sock.sendMessage(jid, { text: outputMsg, mentions: [senderJid] });
                const shell = session.shells[session.shells.length - 1];
                try {
                    await sock.sendMessage(senderJid, {
                        text: t('games.roulette.glass_dm', { shell })
                    });
                } catch {
                    await sock.sendMessage(jid, {
                        text: t('games.roulette.glass_dm_failed', { player: currentPlayer.pushName }),
                        mentions: [senderJid]
                    });
                }
                return null;
            }
            case 'INVERTER': {
                const current = session.shells[session.shells.length - 1];
                session.shells[session.shells.length - 1] = current === 'LIVE' ? 'BLANK' : 'LIVE';
                outputMsg = t('games.roulette.used_inverter', { player: currentPlayer.pushName });
                break;
            }
        }

        const mentions = session.players.map((p) => p.userId);
        await sock.sendMessage(jid, { text: outputMsg, mentions });
        return null;
    }
};

export default useTool;
