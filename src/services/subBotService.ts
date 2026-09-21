import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import Database from 'better-sqlite3';
import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { activeConnections, connectToWhatsApp, stopConnection } from '#utils/connectionManager.js';
import { getPrismaClient, disconnectPrismaClient } from '#db.js';
import { registerCancellableSession, unregisterCancellableSession } from '#utils/cancellationManager.js';
import { loadConfig, clearConfigCache, isFeatureEnabled } from '#services/subBotConfigService.js';
import { renderCard } from '#utils/uiFormatter.js';
import { formatRupiah } from '#utils/currency.js';
import { getPrimaryOwnerNumber } from '#utils/owner.js';

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

/**
 * Returns the persistent host-mounted directory for a given sub-bot phone number.
 * Path: `<STORAGE_DIR>/sub-bot/<phoneNumber>/`
 *
 * This must stay in sync with the equivalent path resolution in `src/db.ts`
 * (`getPrismaClient` non-default branch) so that both modules always access the
 * same on-disk location.
 */
function getSubBotDir(cleanNumber: string): string {
    const storageRoot =
        process.env.STORAGE_DIR ||
        (fs.existsSync('/app/storage') ? '/app/storage' : path.resolve(process.cwd(), 'storage'));
    return path.join(storageRoot, 'sub-bot', cleanNumber);
}

export function isSubBotActive(phoneNumber: string): boolean {
    const clean = getCleanNumber(phoneNumber);
    return activeConnections.has(`sub_${clean}`);
}

/**
 * True link state: a socket entry alone is not enough, because
 * `connectToWhatsApp` registers pairing-mode sockets before the device
 * authorizes them. Only a registered credential means linked.
 */
export function isSubBotLinked(phoneNumber: string): boolean {
    const clean = getCleanNumber(phoneNumber);
    const sock = activeConnections.get(`sub_${clean}`);
    if (!sock) return false;
    try {
        return sock.authState.creds.registered === true;
    } catch {
        return false;
    }
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

    // Guard: Do not wipe credentials or terminate socket if session is already linked or registered!
    if (isSubBotLinked(clean) || isSubBotRegistered(clean)) {
        console.log(
            `[SubBot] Pairing session for +${clean} has already linked/registered. Clearing pairing state without deleting auth.`
        );
        pendingPairings.delete(clean);
        unregisterCancellableSession(`subbot_pair_${clean}`);
        return false;
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

    const primaryNumber = getPrimaryOwnerNumber() || '';
    if (primaryNumber && cleanNumber === primaryNumber) {
        return t('tools.subbot.cannot_pair_self');
    }

    if (isSubBotActive(cleanNumber)) {
        if (!isSubBotLinked(cleanNumber)) {
            await stopSubBot(cleanNumber);
        } else {
            return t('tools.subbot.already_active', { number: cleanNumber });
        }
    }

    if (hasPendingPairing(cleanNumber) || hasPendingPairingByUser(userJid)) {
        abortPairing(cleanNumber);
        for (const [phone, session] of pendingPairings.entries()) {
            const sessionUser = session.userJid.split(':')[0].split('@')[0].toLowerCase();
            const cleanUser = userJid.split(':')[0].split('@')[0].toLowerCase();
            if (sessionUser === cleanUser) {
                abortPairing(phone);
            }
        }
    }

    if (activeConnections.size >= MAX_SUB_BOTS) {
        return t('tools.subbot.max_slots_reached', { current: activeConnections.size, max: MAX_SUB_BOTS });
    }

    try {
        const { QuotaService, executeWithUserLock } = await import('#services/quotaService.js');
        const { isOwnerId } = await import('#utils/owner.js');
        const privileged = isOwnerId(userJid);
        const check = await executeWithUserLock(userJid, () => QuotaService.canPairSubBot(userJid, privileged));
        if (!check.allowed) {
            return (
                `⚠️ *Sub-Bot Quota Reached!*\n\n` +
                `Tier: ${check.tier} Plan\n` +
                `Active Sub-Bots: ${check.current} / ${check.max} instances\n\n` +
                `To pair a new sub-bot:\n` +
                `1. Disconnect an existing sub-bot using: .subbot stop <phone>\n` +
                `2. Upgrade to the Partner Tier (up to 12 sub-bots): https://razael-fox.my.id/pricing`
            );
        }
    } catch (err) {
        console.error('[SubBot] Quota check failed, allowing pairing to proceed:', err);
    }

    const botDir = getSubBotDir(cleanNumber);
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
            if (isSubBotLinked(cleanNumber) || isSubBotRegistered(cleanNumber)) {
                console.log(
                    `[SubBot] Pairing for +${cleanNumber} already linked/registered. Clearing pairing registry.`
                );
                pendingPairings.delete(cleanNumber);
                unregisterCancellableSession(`subbot_pair_${cleanNumber}`);
                return;
            }
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
        isAborted: () => {
            if (isSubBotLinked(cleanNumber) || isSubBotRegistered(cleanNumber)) {
                return false;
            }
            return !pendingPairings.has(cleanNumber);
        },
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

            try {
                await subPrisma.$executeRawUnsafe(`SELECT 1`);
            } catch {
                /* ignore */
            }
            try {
                const defaultPrisma = getPrismaClient('default');
                await defaultPrisma.subBotInstance.upsert({
                    where: { id: cleanNumber },
                    update: { ownerJid: userJid, status: 'ACTIVE' },
                    create: { id: cleanNumber, ownerJid: userJid, status: 'ACTIVE' }
                });
            } catch (err) {
                console.error('[SubBot] Failed to track SubBotInstance ownership:', err);
            }

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

export interface HeadlessPairingResult {
    ok: boolean;
    code?: string;
    qr?: string;
    error?: string;
}

/**
 * Headless sub-bot pairing for web/API clients (no WhatsApp command context).
 *
 * Starts a real Baileys pairing session via `connectToWhatsApp` and resolves
 * with the genuine pairing code (or QR payload) issued by WhatsApp. The
 * session remains pending afterwards so the user can enter the code on the
 * target device; pairing completion is reported through the normal
 * `onConnected` bookkeeping and can be polled via `getSubBotPairingState`.
 */
export async function requestPairingHeadless(
    targetNumber: string,
    method: 'code' | 'qr',
    requesterJid: string
): Promise<HeadlessPairingResult> {
    const cleanNumber = getCleanNumber(targetNumber);
    if (!cleanNumber || cleanNumber.length < 8) {
        return { ok: false, error: 'INVALID_PHONE' };
    }

    const primaryNumber = getPrimaryOwnerNumber() || '';
    if (primaryNumber && cleanNumber === primaryNumber) {
        return { ok: false, error: 'CANNOT_PAIR_SELF' };
    }

    if (isSubBotActive(cleanNumber)) {
        if (!isSubBotLinked(cleanNumber)) {
            await stopSubBot(cleanNumber);
        } else {
            return { ok: false, error: 'ALREADY_ACTIVE' };
        }
    }

    if (hasPendingPairing(cleanNumber) || hasPendingPairingByUser(requesterJid)) {
        abortPairing(cleanNumber);
        for (const [phone, session] of pendingPairings.entries()) {
            const sessionUser = session.userJid.split(':')[0].split('@')[0].toLowerCase();
            const cleanUser = requesterJid.split(':')[0].split('@')[0].toLowerCase();
            if (sessionUser === cleanUser) {
                abortPairing(phone);
            }
        }
    }

    if (activeConnections.size >= MAX_SUB_BOTS) {
        return { ok: false, error: 'MAX_SLOTS_REACHED' };
    }

    try {
        const { QuotaService, executeWithUserLock } = await import('#services/quotaService.js');
        const { isOwnerId } = await import('#utils/owner.js');
        const privileged = isOwnerId(requesterJid);
        const check = await executeWithUserLock(requesterJid, () =>
            QuotaService.canPairSubBot(requesterJid, privileged)
        );
        if (!check.allowed) {
            return { ok: false, error: 'QUOTA_EXCEEDED' };
        }
    } catch (err) {
        console.error('[SubBot] Headless quota check failed, allowing pairing to proceed:', err);
    }

    const botDir = getSubBotDir(cleanNumber);
    if (!fs.existsSync(botDir)) {
        fs.mkdirSync(botDir, { recursive: true });
    }

    const subPrisma = getPrismaClient(`sub_${cleanNumber}`);
    try {
        await subPrisma.whatsAppAuth.deleteMany();
    } catch {
        /* ignore */
    }

    const pairingSession: PairingSession = {
        phoneNumber: cleanNumber,
        method,
        userJid: requesterJid,
        chatJid: requesterJid,
        startTime: Date.now()
    };
    pendingPairings.set(cleanNumber, pairingSession);

    registerCancellableSession({
        sessionId: `subbot_pair_${cleanNumber}`,
        feature: 'subbot',
        userJid: requesterJid,
        chatJid: requesterJid,
        description: `Sub-bot pairing for +${cleanNumber}`,
        onCancel: async () => {
            abortPairing(cleanNumber);
            return 'Sub-bot pairing cancelled.';
        }
    });

    const ttlSeconds = method === 'code' ? 120 : 60;
    pairingSession.timeoutTimer = setTimeout(() => {
        if (pendingPairings.has(cleanNumber)) {
            if (isSubBotLinked(cleanNumber) || isSubBotRegistered(cleanNumber)) {
                console.log(
                    `[SubBot] Headless pairing for +${cleanNumber} already linked/registered. Clearing pairing registry.`
                );
                pendingPairings.delete(cleanNumber);
                unregisterCancellableSession(`subbot_pair_${cleanNumber}`);
                return;
            }
            console.log(`[SubBot] Headless pairing for +${cleanNumber} timed out, aborting.`);
            abortPairing(cleanNumber);
        }
    }, ttlSeconds * 1000);

    let credentialSent = false;
    let resolveCredential: (value: string) => void = () => {};
    const credentialPromise = new Promise<string>((resolve) => {
        resolveCredential = resolve;
    });

    connectToWhatsApp({
        sessionId: `sub_${cleanNumber}`,
        phoneNumber: cleanNumber,
        pairingMethod: method,
        isPairingMode: true,
        isAborted: () => {
            if (isSubBotLinked(cleanNumber) || isSubBotRegistered(cleanNumber)) {
                return false;
            }
            return !pendingPairings.has(cleanNumber);
        },
        onPairingCode: async (formattedCode: string) => {
            if (method !== 'code' || credentialSent) return;
            credentialSent = true;
            console.log(`[SubBot] Headless pairing code issued for +${cleanNumber}.`);
            resolveCredential(formattedCode);
        },
        onQRCode: async (qrString: string) => {
            if (method !== 'qr' || credentialSent) return;
            credentialSent = true;
            console.log(`[SubBot] Headless pairing QR issued for +${cleanNumber}.`);
            resolveCredential(qrString);
        },
        onConnected: async () => {
            if (pairingSession.timeoutTimer) {
                clearTimeout(pairingSession.timeoutTimer);
            }
            pendingPairings.delete(cleanNumber);
            unregisterCancellableSession(`subbot_pair_${cleanNumber}`);
            subBotStartTimes.set(cleanNumber, Date.now());

            try {
                const defaultPrisma = getPrismaClient('default');
                await defaultPrisma.subBotInstance.upsert({
                    where: { id: cleanNumber },
                    update: { ownerJid: requesterJid, status: 'ACTIVE' },
                    create: { id: cleanNumber, ownerJid: requesterJid, status: 'ACTIVE' }
                });
            } catch (err) {
                console.error('[SubBot] Failed to track headless SubBotInstance ownership:', err);
            }

            loadConfig(cleanNumber);

            try {
                const defaultSock = activeConnections.get('default');
                if (defaultSock && requesterJid) {
                    await defaultSock.sendMessage(requesterJid, {
                        text:
                            `✅ *Sub-Bot Linked Successfully*\n\n` +
                            `Number: +${cleanNumber}\n` +
                            `Status: ONLINE\n\n` +
                            `Manage it anytime from your web dashboard or with .subbot commands.`
                    });
                }
            } catch (err) {
                console.error('[SubBot] Failed to send headless pairing success notice:', err);
            }
        },
        onClosed: () => {
            subBotStartTimes.delete(cleanNumber);
        }
    });

    const credential = await Promise.race([
        credentialPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 60000))
    ]);

    if (credential === null) {
        abortPairing(cleanNumber);
        return { ok: false, error: method === 'code' ? 'CODE_TIMEOUT' : 'QR_TIMEOUT' };
    }

    return method === 'code' ? { ok: true, code: credential } : { ok: true, qr: credential };
}

/**
 * Pairing state for web/API polling: ACTIVE (linked), PAIRING (awaiting
 * device authorization), or IDLE (no session).
 */
export function getSubBotPairingState(phoneNumber: string): 'ACTIVE' | 'PAIRING' | 'IDLE' {
    if (isSubBotLinked(phoneNumber) || isSubBotRegistered(phoneNumber)) return 'ACTIVE';
    if (hasPendingPairing(phoneNumber)) return 'PAIRING';
    return 'IDLE';
}

export async function stopSubBot(phoneNumber: string): Promise<boolean> {
    const clean = getCleanNumber(phoneNumber);
    const sessionId = `sub_${clean}`;
    stopConnection(sessionId);
    subBotStartTimes.delete(clean);
    await disconnectPrismaClient(sessionId);
    return true;
}

export function isSubBotRegistered(phoneNumber: string): boolean {
    const clean = getCleanNumber(phoneNumber);
    const sock = activeConnections.get(`sub_${clean}`);
    if (sock) {
        try {
            if (sock.authState?.creds?.registered === true) return true;
        } catch {
            /* ignore */
        }
    }

    const dbPath = path.join(getSubBotDir(clean), 'database.sqlite');
    if (!fs.existsSync(dbPath)) return false;

    try {
        const db = new Database(dbPath, { readonly: true });
        const row = db
            .prepare('SELECT value FROM "WhatsAppAuth" WHERE id = ? OR id = ?')
            .get(`sub_${clean}_creds.json`, 'creds.json') as { value: string } | undefined;
        db.close();
        if (!row || !row.value) return false;
        const creds = JSON.parse(row.value);
        return creds?.registered === true;
    } catch {
        return false;
    }
}

export async function startSubBot(phoneNumber: string): Promise<boolean> {
    const clean = getCleanNumber(phoneNumber);
    const sessionId = `sub_${clean}`;
    if (activeConnections.has(sessionId)) return false;

    const botDir = getSubBotDir(clean);
    if (!fs.existsSync(botDir)) return false;

    if (!isSubBotRegistered(clean)) {
        console.warn(`[SubBot] Cannot start sub-bot +${clean}: Not registered or pairing incomplete.`);
        return false;
    }

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
    try {
        const defaultPrisma = getPrismaClient('default');
        await defaultPrisma.subBotInstance.delete({ where: { id: clean } }).catch(() => {});
    } catch {
        /* ignore */
    }
    clearConfigCache(clean);

    const botDir = getSubBotDir(clean);
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
    const storageRoot =
        process.env.STORAGE_DIR ||
        (fs.existsSync('/app/storage') ? '/app/storage' : path.resolve(process.cwd(), 'storage'));
    const dbDir = path.join(storageRoot, 'sub-bot');
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
    const storageRoot =
        process.env.STORAGE_DIR ||
        (fs.existsSync('/app/storage') ? '/app/storage' : path.resolve(process.cwd(), 'storage'));
    const dbDir = path.join(storageRoot, 'sub-bot');
    if (!fs.existsSync(dbDir)) return;

    try {
        const entries = fs.readdirSync(dbDir, { withFileTypes: true });
        const subBotNumbers = entries
            .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
            .map((e) => e.name)
            .filter((num) => isSubBotRegistered(num));

        console.log(`[SubBot] Discovered ${subBotNumbers.length} registered sub-bots on disk.`);
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
