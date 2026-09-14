import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { activeConnections, connectToWhatsApp } from '#utils/connectionManager.js';
import { getPrismaClient, disconnectPrismaClient } from '#db.js';
import { registerCancellableSession, unregisterCancellableSession } from '#utils/cancellationManager.js';
import { loadConfig, clearConfigCache, isFeatureEnabled } from '#services/subBotConfigService.js';
import { renderCard } from '#utils/uiFormatter.js';
import { formatRupiah } from '#utils/currency.js';

export const MAX_SUB_BOTS = 50;

interface PairingSession {
    phoneNumber: string;
    method: 'code' | 'qr';
    userJid: string;
    chatJid: string;
    timeoutTimer?: NodeJS.Timeout;
    tempSock?: WASocket;
    startTime: number;
}

const pendingPairings = new Map<string, PairingSession>();
const subBotStartTimes = new Map<string, number>();

export function getCleanNumber(raw: string): string {
    return raw.replace(/\D/g, '');
}

export function isSubBotActive(phoneNumber: string): boolean {
    const clean = getCleanNumber(phoneNumber);
    return activeConnections.has(`sub_${clean}`);
}

export function hasPendingPairing(phoneNumber: string): boolean {
    const clean = getCleanNumber(phoneNumber);
    return pendingPairings.has(clean);
}

export function hasPendingPairingByUser(userJid: string): boolean {
    const cleanUser = userJid.split(':')[0].split('@')[0].toLowerCase();
    for (const session of pendingPairings.values()) {
        const sessionUser = session.userJid.split(':')[0].split('@')[0].toLowerCase();
        if (cleanUser === sessionUser) {
            return true;
        }
    }
    return false;
}

export function abortPairing(phoneNumber: string): boolean {
    const clean = getCleanNumber(phoneNumber);
    const session = pendingPairings.get(clean);
    if (!session) return false;

    if (session.timeoutTimer) {
        clearTimeout(session.timeoutTimer);
    }
    const sock = session.tempSock || activeConnections.get(`sub_${clean}`);
    if (sock) {
        try {
            sock.end(undefined);
        } catch {
            /* ignore */
        }
    }
    activeConnections.delete(`sub_${clean}`);
    unregisterCancellableSession(`subbot_pair_${clean}`);
    pendingPairings.delete(clean);

    try {
        const subPrisma = getPrismaClient(`sub_${clean}`);
        subPrisma.whatsAppAuth.deleteMany().catch(() => {});
    } catch {
        /* ignore */
    }

    return true;
}

export async function requestPairing(
    targetNumber: string,
    method: 'code' | 'qr',
    userJid: string,
    chatJid: string,
    parentSock: WASocket,
    parentMsg: WAMessage,
    t: (key: string, variablesOrFallback?: Record<string, any> | string, variables?: Record<string, any>) => string
): Promise<string | void> {
    const cleanNumber = getCleanNumber(targetNumber);
    if (!cleanNumber || cleanNumber.length < 8) {
        return '❌ Invalid phone number format. Please provide international format (e.g. 628123456789).';
    }

    const primaryNumber = getCleanNumber(process.env.BOT_PHONE_NUMBER || '');
    if (primaryNumber && cleanNumber === primaryNumber) {
        return t('tools.subbot.cannot_pair_self');
    }

    if (isSubBotActive(cleanNumber)) {
        return t('tools.subbot.already_active', { number: cleanNumber });
    }

    if (hasPendingPairing(cleanNumber) || hasPendingPairingByUser(userJid)) {
        return t('tools.subbot.already_pairing');
    }

    if (activeConnections.size >= MAX_SUB_BOTS) {
        return t('tools.subbot.max_slots_reached', { current: activeConnections.size, max: MAX_SUB_BOTS });
    }

    const botDir = path.resolve(process.cwd(), 'database', cleanNumber);
    if (!fs.existsSync(botDir)) {
        fs.mkdirSync(botDir, { recursive: true });
    }

    // Ensure database and schema are initialized and clear previous stale credentials
    const subPrisma = getPrismaClient(`sub_${cleanNumber}`);
    try {
        await subPrisma.whatsAppAuth.deleteMany();
    } catch {
        /* ignore */
    }

    const pairingSession: PairingSession = {
        phoneNumber: cleanNumber,
        method,
        userJid,
        chatJid,
        startTime: Date.now()
    };
    pendingPairings.set(cleanNumber, pairingSession);

    registerCancellableSession({
        sessionId: `subbot_pair_${cleanNumber}`,
        feature: 'subbot',
        userJid,
        chatJid,
        description: `Sub-bot pairing for +${cleanNumber}`,
        onCancel: async () => {
            abortPairing(cleanNumber);
            return t('tools.subbot.pairing_cancelled');
        }
    });

    const ttlSeconds = method === 'code' ? 120 : 60;
    pairingSession.timeoutTimer = setTimeout(async () => {
        if (pendingPairings.has(cleanNumber)) {
            abortPairing(cleanNumber);
            try {
                await parentSock.sendMessage(
                    chatJid,
                    { text: `⚠️ ${t('tools.subbot.pairing_timeout')}` },
                    { quoted: parentMsg }
                );
            } catch (err) {
                console.error(`[SubBot] Failed to send pairing timeout notice:`, err);
            }
        }
    }, ttlSeconds * 1000);

    let pairingCardSent = false;

    connectToWhatsApp({
        sessionId: `sub_${cleanNumber}`,
        phoneNumber: cleanNumber,
        pairingMethod: method,
        isPairingMode: true,
        isAborted: () => !pendingPairings.has(cleanNumber),
        onPairingCode: async (formattedCode: string) => {
            if (method !== 'code' || pairingCardSent) return;
            pairingCardSent = true;

            const card = renderCard({
                title: t('tools.subbot.pairing_title'),
                icon: '📱',
                headerStyle: 'heavy',
                fields: [
                    { label: t('tools.subbot.target_number'), value: `+${cleanNumber}`, boldLabel: true },
                    { label: t('tools.subbot.code_label'), value: `*${formattedCode}*`, boldLabel: true },
                    { label: t('tools.subbot.expires_in'), value: '120s' }
                ],
                sections: [
                    {
                        title: t('tools.subbot.instructions_title'),
                        items: [
                            { label: '1.', value: t('tools.subbot.instruction_1') },
                            { label: '2.', value: t('tools.subbot.instruction_2') },
                            { label: '3.', value: t('tools.subbot.instruction_3') },
                            { label: '4.', value: t('tools.subbot.instruction_4') }
                        ]
                    }
                ],
                tip: t('tools.subbot.cancel_tip')
            });

            await parentSock.sendMessage(chatJid, { text: card }, { quoted: parentMsg });
        },
        onQRCode: async (qrString: string) => {
            if (method !== 'qr' || pairingCardSent) return;
            pairingCardSent = true;

            try {
                const qrBuffer = await QRCode.toBuffer(qrString, {
                    type: 'png',
                    width: 512,
                    margin: 2,
                    color: { dark: '#000000', light: '#ffffff' }
                });

                const caption =
                    `╭━━━〔 📱 *${t('tools.subbot.pairing_title')}* 〕━━━╮\n` +
                    `┃\n` +
                    `┃ 📲 ${t('tools.subbot.target_number')}: +${cleanNumber}\n` +
                    `┃ ⏳ ${t('tools.subbot.expires_in')}: 60s\n` +
                    `┃\n` +
                    `┃ 📷 ${t('tools.subbot.qr_instruction')}\n` +
                    `┃\n` +
                    `┃ 💡 ${t('tools.subbot.cancel_tip')}\n` +
                    `╰━━━━━━━━━━━━━━━━━━━━━╯`;

                await parentSock.sendMessage(chatJid, { image: qrBuffer, caption }, { quoted: parentMsg });
            } catch (err) {
                console.error('[SubBot] Error generating QR buffer:', err);
                await parentSock.sendMessage(
                    chatJid,
                    { text: '❌ Failed to generate QR code image.' },
                    { quoted: parentMsg }
                );
            }
        },
        onConnected: async () => {
            if (pairingSession.timeoutTimer) {
                clearTimeout(pairingSession.timeoutTimer);
            }
            pendingPairings.delete(cleanNumber);
            unregisterCancellableSession(`subbot_pair_${cleanNumber}`);
            subBotStartTimes.set(cleanNumber, Date.now());

            loadConfig(cleanNumber);

            const successCard = renderCard({
                title: t('tools.subbot.dashboard_title'),
                icon: '🎉',
                headerStyle: 'heavy',
                body: t('tools.subbot.pairing_success'),
                fields: [
                    { label: t('tools.subbot.device_number'), value: `+${cleanNumber}` },
                    { label: t('tools.subbot.status_label'), value: 'ONLINE' }
                ],
                tip: 'Use .config to view and customize your sub-bot features.'
            });

            await parentSock.sendMessage(chatJid, { text: successCard }, { quoted: parentMsg });
        },
        onClosed: () => {
            subBotStartTimes.delete(cleanNumber);
        }
    });
}

export async function stopSubBot(phoneNumber: string): Promise<boolean> {
    const clean = getCleanNumber(phoneNumber);
    const sessionId = `sub_${clean}`;
    const sock = activeConnections.get(sessionId);
    if (sock) {
        try {
            sock.end(undefined);
        } catch {
            /* ignore */
        }
        activeConnections.delete(sessionId);
        subBotStartTimes.delete(clean);
        await disconnectPrismaClient(sessionId);
        return true;
    }
    return false;
}

export async function startSubBot(phoneNumber: string): Promise<boolean> {
    const clean = getCleanNumber(phoneNumber);
    const sessionId = `sub_${clean}`;
    if (activeConnections.has(sessionId)) return false;

    const botDir = path.resolve(process.cwd(), 'database', clean);
    if (!fs.existsSync(botDir)) return false;

    connectToWhatsApp({
        sessionId,
        phoneNumber: clean,
        onConnected: () => {
            subBotStartTimes.set(clean, Date.now());
            console.log(`[SubBot] Sub-bot +${clean} connected.`);
        },
        onClosed: () => {
            subBotStartTimes.delete(clean);
        }
    });

    return true;
}

export async function deleteSubBot(phoneNumber: string): Promise<boolean> {
    const clean = getCleanNumber(phoneNumber);
    await stopSubBot(clean);
    clearConfigCache(clean);

    const botDir = path.resolve(process.cwd(), 'database', clean);
    if (fs.existsSync(botDir)) {
        try {
            fs.rmSync(botDir, { recursive: true, force: true });
            return true;
        } catch (err) {
            console.error(`[SubBot] Error deleting directory for ${clean}:`, err);
            return false;
        }
    }
    return true;
}

export function getSubBotStatus(phoneNumber: string) {
    const clean = getCleanNumber(phoneNumber);
    const sessionId = `sub_${clean}`;
    const isConnected = activeConnections.has(sessionId);
    const config = loadConfig(clean);
    const startTime = subBotStartTimes.get(clean) || 0;
    const uptimeSec = isConnected && startTime > 0 ? Math.floor((Date.now() - startTime) / 1000) : 0;

    return {
        phoneNumber: clean,
        isConnected,
        uptimeSec,
        config
    };
}

export function listAllSubBots() {
    const dbDir = path.resolve(process.cwd(), 'database');
    if (!fs.existsSync(dbDir)) return [];

    const entries = fs.readdirSync(dbDir, { withFileTypes: true });
    return entries
        .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
        .map((e) => {
            const num = e.name;
            const isConnected = activeConnections.has(`sub_${num}`);
            const config = loadConfig(num);
            const startTime = subBotStartTimes.get(num) || 0;
            const uptimeSec = isConnected && startTime > 0 ? Math.floor((Date.now() - startTime) / 1000) : 0;
            return {
                phoneNumber: num,
                isConnected,
                uptimeSec,
                config
            };
        });
}

export async function broadcastSubBotForex(multiplier: number, reasoning: string, rate: number): Promise<void> {
    const message =
        `*🏦 Cosmos Central Bank Update*\n\n` +
        `*Current Exchange Rate:* $1 = ${formatRupiah(rate)}\n` +
        `*Market Trend:* 📉 AI Evaluated\n\n` +
        `*🔄 Economic Adjustments:*\n` +
        `• Global Inflation Multiplier: *${multiplier}x*\n` +
        `• Shop & Loot: ⬆️ *Adjusted proportionally*\n\n` +
        `_🤖 AI Analyst Note: "${reasoning}"_`;

    for (const [sessionId, sock] of activeConnections.entries()) {
        if (!sessionId.startsWith('sub_')) continue;
        const cleanNumber = sessionId.replace(/^sub_/, '');
        if (!isFeatureEnabled(cleanNumber, 'forexAnnouncement')) {
            console.log(`[FOREX Broadcast] Sub-bot +${cleanNumber} disabled forex announcement. Skipping.`);
            continue;
        }

        try {
            const subPrisma = getPrismaClient(sessionId);
            const groups = await subPrisma.whitelistedGroup.findMany();
            for (const group of groups) {
                await sock.sendMessage(group.jid, { text: message });
            }
        } catch (err) {
            console.error(`[FOREX Broadcast] Failed to broadcast to sub-bot +${cleanNumber}:`, err);
        }
    }
}

export function initSubBots(): void {
    const dbDir = path.resolve(process.cwd(), 'database');
    if (!fs.existsSync(dbDir)) return;

    try {
        const entries = fs.readdirSync(dbDir, { withFileTypes: true });
        const subBotNumbers = entries.filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => e.name);

        console.log(`[SubBot] Discovered ${subBotNumbers.length} existing sub-bots on disk.`);
        for (let i = 0; i < subBotNumbers.length; i++) {
            const num = subBotNumbers[i];
            setTimeout(() => {
                console.log(`[SubBot] Staggered boot: Starting sub-bot +${num} (${i + 1}/${subBotNumbers.length})...`);
                startSubBot(num).catch((err) => {
                    console.error(`[SubBot] Error starting sub-bot +${num}:`, err);
                });
            }, i * 3000);
        }
    } catch (err) {
        console.error('[SubBot] Error scanning database directory for sub-bots:', err);
    }
}
