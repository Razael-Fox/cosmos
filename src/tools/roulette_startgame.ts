import { ToolModule, ToolContext } from './types.js';
import { getSessionByChatId, generateShells, getRandomItems } from '../utils/roulette.js';
import { getSenderJid } from '../utils/casino.js';
import { formatRupiah } from '../utils/currency.js';
import { unregisterCancellableSession } from '../utils/cancellationManager.js';
import { getTranslator } from '../utils/i18n.js';

const startGameTool: ToolModule = {
    definition: {
        name: 'startgame',
        description: 'Start the Buckshot Roulette minigame',
        descriptionKey: 'tools.commands.startgame.description',
        category: 'Games'
    },
    execute: async (args: Record<string, any>, ctx: ToolContext) => {
        const t = ctx?.t || getTranslator('en');
        const { msg, sock, jid } = ctx;
        const senderJid = getSenderJid(msg, sock);

        const session = getSessionByChatId(jid);
        if (!session) {
            return t('games.roulette.no_session');
        }

        if (session.status !== 'LOBBY') {
            return t('games.roulette.already_started');
        }

        if (session.players[0].userId !== senderJid) {
            return t('games.roulette.creator_only_start');
        }

        if (session.players.length < 2) {
            return t('games.roulette.min_players');
        }

        // Check if all players have bet
        const nonBetters = session.players.filter((p) => p.betAmount === 0);
        if (nonBetters.length > 0) {
            const names = nonBetters.map((p) => `@${p.pushName}`).join(', ');
            return t('games.roulette.non_betters', { names });
        }

        // Clear timeout
        if (session.timeoutId) {
            clearTimeout(session.timeoutId);
            session.timeoutId = undefined;
        }

        unregisterCancellableSession(`roulette_${session.sessionId}`);

        session.status = 'PLAYING';
        session.shells = generateShells();
        session.turnIndex = 0;
        session.lastActionAt = Date.now();

        // Give items
        for (const player of session.players) {
            player.inventory.push(...getRandomItems(2));
        }

        const startMsg = t('games.roulette.game_started_announcement', {
            count: session.players.length,
            pot: formatRupiah(session.potAmount)
        });
        await sock.sendMessage(jid, { text: startMsg });

        // Delay before announcing round 1
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const liveCount = session.shells.filter((s) => s === 'LIVE').length;
        const blankCount = session.shells.length - liveCount;

        const firstPlayer = session.players[session.turnIndex];
        const inventoryStr =
            firstPlayer.inventory.length > 0
                ? firstPlayer.inventory.map((i) => i.replace('_', ' ')).join(', ')
                : 'Empty';

        const roundMsg = t('games.roulette.round_begins', {
            live: liveCount,
            blank: blankCount,
            total: session.shells.length,
            player: firstPlayer.pushName,
            lives: `${'❤️'.repeat(firstPlayer.hp)}${'🖤'.repeat(5 - firstPlayer.hp)}`,
            inventory: inventoryStr,
            status: 'None'
        });

        return roundMsg;
    }
};

export default startGameTool;
