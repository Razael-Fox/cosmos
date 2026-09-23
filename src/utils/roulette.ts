import { renderHealthGauge, type TranslatorFn } from './uiFormatter.js';
import { getTranslator } from './i18n.js';

export function formatRouletteItem(item: string, t?: TranslatorFn): string {
    const tr = t || getTranslator('id');
    switch (item) {
        case 'COLA':
            return tr('games.roulette.item_cola');
        case 'CIGARETTES':
            return tr('games.roulette.item_cigarettes');
        case 'HAND_SAW':
            return tr('games.roulette.item_hand_saw');
        case 'HANDCUFFS':
            return tr('games.roulette.item_handcuffs');
        case 'MAGNIFYING_GLASS':
            return tr('games.roulette.item_magnifying_glass');
        case 'INVERTER':
            return tr('games.roulette.item_inverter');
        default:
            return item.replace('_', ' ');
    }
}

export type ItemType = 'COLA' | 'MAGNIFYING_GLASS' | 'HAND_SAW' | 'HANDCUFFS' | 'CIGARETTES' | 'INVERTER';
export type ShellType = 'LIVE' | 'BLANK';
export type GameStatus = 'LOBBY' | 'PLAYING' | 'FINISHED';

export interface Player {
    userId: string;
    pushName: string;
    hp: number;
    inventory: ItemType[];
    betAmount: number;
    isHandcuffed: boolean;
    hasUsedItemThisTurn: boolean;
    handSawActive: boolean;
    isAfk: boolean;
}

export interface GameSession {
    sessionId: string;
    chatId: string;
    status: GameStatus;
    players: Player[];
    potAmount: number;
    turnIndex: number;
    shells: ShellType[];
    createdAt: number;
    lastActionAt: number;
    timeoutId?: NodeJS.Timeout;
}

export const gameSessions = new Map<string, GameSession>();

export function generateSessionId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < 5; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

export function generateShells(): ShellType[] {
    const count = 5 + Math.floor(Math.random() * 3); // 5 to 7 shells
    const liveCount = Math.floor(count / 2) + (Math.random() > 0.5 ? 1 : 0);
    const shells: ShellType[] = [];

    for (let i = 0; i < liveCount; i++) shells.push('LIVE');
    for (let i = 0; i < count - liveCount; i++) shells.push('BLANK');

    return shells.sort(() => Math.random() - 0.5);
}

export function getRandomItems(count: number): ItemType[] {
    const allItems: ItemType[] = ['COLA', 'MAGNIFYING_GLASS', 'HAND_SAW', 'HANDCUFFS', 'CIGARETTES', 'INVERTER'];
    const items: ItemType[] = [];
    for (let i = 0; i < count; i++) {
        items.push(allItems[Math.floor(Math.random() * allItems.length)]);
    }
    return items;
}

export function getSessionByChatId(chatId: string): GameSession | undefined {
    for (const session of gameSessions.values()) {
        if (session.chatId === chatId) {
            return session;
        }
    }
    return undefined;
}

export function handleElimination(session: GameSession, deadPlayer: Player, t?: TranslatorFn): string {
    const tr = t || getTranslator('id');
    let msg = tr('games.roulette.eliminated', { player: deadPlayer.pushName });

    const alivePlayers = session.players.filter((p) => p.hp > 0);

    if (deadPlayer.inventory.length > 0 && alivePlayers.length > 0) {
        msg += tr('games.roulette.death_loot', { player: deadPlayer.pushName });

        for (const item of deadPlayer.inventory) {
            const eligiblePlayers = alivePlayers.filter((p) => p.inventory.length < 4);
            if (eligiblePlayers.length > 0) {
                const receiver = eligiblePlayers[Math.floor(Math.random() * eligiblePlayers.length)];
                receiver.inventory.push(item);
                msg += tr('games.roulette.death_loot_item', {
                    player: receiver.pushName,
                    item: formatRouletteItem(item, tr)
                });
            }
        }
    }
    deadPlayer.inventory = [];
    return msg;
}

export function nextTurn(session: GameSession, shouldRandomize: boolean, t?: TranslatorFn): string {
    const tr = t || getTranslator('id');
    const alivePlayers = session.players.filter((p) => p.hp > 0);
    if (alivePlayers.length <= 1) return '';

    if (shouldRandomize) {
        const randomPlayer = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
        session.turnIndex = session.players.findIndex((p) => p.userId === randomPlayer.userId);
    } else {
        do {
            session.turnIndex = (session.turnIndex + 1) % session.players.length;
        } while (session.players[session.turnIndex].hp <= 0);
    }

    const nextPlayer = session.players[session.turnIndex];
    nextPlayer.hasUsedItemThisTurn = false;

    let msg = tr('games.roulette.next_turn', { player: nextPlayer.pushName });

    if (nextPlayer.isHandcuffed) {
        nextPlayer.isHandcuffed = false;
        msg += tr('games.roulette.handcuffed_skip', { player: nextPlayer.pushName });
        msg += nextTurn(session, false, tr);
    } else {
        const inventoryStr =
            nextPlayer.inventory.length > 0
                ? nextPlayer.inventory.map((i) => formatRouletteItem(i, tr)).join(', ')
                : tr('games.roulette.inventory_empty');
        const livesStr = renderHealthGauge(nextPlayer.hp, 5, tr);
        const statusStr = nextPlayer.handSawActive
            ? tr('games.roulette.item_hand_saw_active')
            : tr('games.roulette.status_none');
        msg += tr('games.roulette.player_status', {
            lives: livesStr,
            inventory: inventoryStr,
            status: statusStr
        });
    }

    return msg;
}

export function checkReloadShells(session: GameSession, t?: TranslatorFn): string {
    if (session.shells.length > 0) return '';

    const tr = t || getTranslator('id');
    session.shells = generateShells();
    for (const player of session.players.filter((p) => p.hp > 0)) {
        player.inventory.push(...getRandomItems(2));
        // Ensure max 4 items
        if (player.inventory.length > 4) player.inventory.splice(4);
    }

    const liveCount = session.shells.filter((s) => s === 'LIVE').length;
    const blankCount = session.shells.length - liveCount;

    return tr('games.roulette.new_round', {
        live: liveCount,
        blank: blankCount,
        total: session.shells.length
    });
}
