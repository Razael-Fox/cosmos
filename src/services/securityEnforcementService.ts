import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { prisma } from '../db.js';
import { isOwnerId, getPrimaryOwnerNumber } from '../utils/owner.js';
import { MaliciousDetectionResult } from '../utils/security/bugDetector.js';

interface BlacklistEntry {
    severity: 'WARNING' | 'BLOCKED';
    reason: string;
    expiresAt: number;
}

const MAX_BLACKLIST_ENTRIES = 5000;
const DEFAULT_BLOCK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const WARNING_TTL_MS = 60 * 60 * 1000; // 1 hour

// Rate-limiting block calls to WhatsApp server (Max 1 block per 10s to prevent account bans)
const BLOCK_EXECUTION_INTERVAL_MS = 10000;
const OWNER_ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class SecurityEnforcementService {
    private blacklistCache: Map<string, BlacklistEntry> = new Map();
    private pendingBlockQueue: Set<string> = new Set();
    private isProcessingBlockQueue = false;
    private lastBlockTime = 0;
    private recentAlerts: Map<string, number> = new Map();

    /**
     * Checks if a JID/LID is currently blacklisted in the fast in-memory cache.
     */
    public isBlacklisted(identifier: string): boolean {
        if (!identifier) return false;
        const entry = this.blacklistCache.get(identifier);
        if (!entry) return false;

        if (Date.now() > entry.expiresAt) {
            this.blacklistCache.delete(identifier);
            return false;
        }

        return entry.severity === 'BLOCKED';
    }

    /**
     * Adds an actor to the fast in-memory blacklist cache.
     */
    public recordInMemory(identifier: string, severity: 'WARNING' | 'BLOCKED', reason: string): void {
        if (!identifier || isOwnerId(identifier)) return;

        if (this.blacklistCache.size >= MAX_BLACKLIST_ENTRIES) {
            this.evictExpiredOrOldest();
        }

        const ttl = severity === 'BLOCKED' ? DEFAULT_BLOCK_TTL_MS : WARNING_TTL_MS;
        this.blacklistCache.set(identifier, {
            severity,
            reason,
            expiresAt: Date.now() + ttl
        });
    }

    /**
     * Handles detection and executes layered countermeasures.
     */
    public async handleMaliciousActor(
        sock: WASocket,
        msg: WAMessage,
        detection: MaliciousDetectionResult,
        senderJid: string,
        senderLid?: string | null
    ): Promise<void> {
        if (!senderJid || isOwnerId(senderJid)) return;

        const reason = detection.reason || 'Detected malicious activity';
        const severity = detection.severity || 'BLOCKED';

        // 1. Record in fast in-memory blacklist
        this.recordInMemory(senderJid, severity, reason);
        if (senderLid) {
            this.recordInMemory(senderLid, severity, reason);
        }

        // 2. Log incident to Pterodactyl console
        console.error(
            `[SECURITY_SHIELD] Malicious activity intercepted from ${senderJid}${senderLid ? ` (LID: ${senderLid})` : ''} - Type: ${detection.type} - Severity: ${severity} - Reason: ${reason}`
        );

        // 3. Persist incident in database
        await this.persistIncident(senderJid, senderLid, detection, reason, severity);

        // 4. Safe group message deletion (only if bot is admin)
        const chatJid = msg.key.remoteJid;
        const isGroup = chatJid?.endsWith('@g.us');

        if (isGroup && chatJid && msg.key.id) {
            await this.safeDeleteGroupMessage(sock, chatJid, msg);
        }

        // 5. Throttled WhatsApp account blocking for DMs / severe offenses
        if (severity === 'BLOCKED' && !senderJid.endsWith('@g.us')) {
            this.queueSocketBlock(sock, senderJid);
        }

        // 6. Asynchronous Owner Alerting (Throttled)
        this.dispatchOwnerAlert(sock, senderJid, detection, reason);
    }

    /**
     * Persists malicious actor in SQLite database.
     */
    private async persistIncident(
        senderJid: string,
        senderLid: string | null | undefined,
        detection: MaliciousDetectionResult,
        reason: string,
        severity: 'WARNING' | 'BLOCKED'
    ): Promise<void> {
        try {
            const details = JSON.stringify({
                type: detection.type,
                confidence: detection.confidence,
                timestamp: new Date().toISOString()
            });

            await prisma.maliciousActor.upsert({
                where: { jid: senderJid },
                update: {
                    lid: senderLid || undefined,
                    reason,
                    severity,
                    details,
                    updatedAt: new Date()
                },
                create: {
                    jid: senderJid,
                    lid: senderLid || undefined,
                    reason,
                    severity,
                    details
                }
            });
        } catch (err) {
            console.error('[SECURITY_SHIELD] Failed to persist MaliciousActor in database:', err);
        }
    }

    /**
     * Safely deletes a message in a group chat only if the bot is admin.
     */
    private async safeDeleteGroupMessage(sock: WASocket, groupJid: string, msg: WAMessage): Promise<void> {
        try {
            const groupMetadata = await sock.groupMetadata(groupJid);
            const botJid = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : '';
            const botParticipant = groupMetadata.participants.find((p) => {
                const pId = p.id.split(':')[0].split('@')[0];
                return pId === botJid;
            });

            const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

            if (isBotAdmin) {
                await sock.sendMessage(groupJid, { delete: msg.key });
                console.log(
                    `[SECURITY_SHIELD] Successfully deleted malicious message ${msg.key.id} in group ${groupJid}`
                );
            } else {
                console.log(
                    `[SECURITY_SHIELD] Skipped deleting message ${msg.key.id} in ${groupJid} because bot is not group admin`
                );
            }
        } catch (err) {
            console.error(
                `[SECURITY_SHIELD] Failed to evaluate group admin status or delete message in ${groupJid}:`,
                err
            );
        }
    }

    /**
     * Enqueues a user JID for throttled socket blocking.
     */
    private queueSocketBlock(sock: WASocket, userJid: string): void {
        if (this.pendingBlockQueue.has(userJid)) return;
        this.pendingBlockQueue.add(userJid);
        this.processBlockQueue(sock);
    }

    /**
     * Processes block queue sequentially with rate-limit delays to prevent WhatsApp server bans.
     */
    private async processBlockQueue(sock: WASocket): Promise<void> {
        if (this.isProcessingBlockQueue) return;
        this.isProcessingBlockQueue = true;

        try {
            while (this.pendingBlockQueue.size > 0) {
                const now = Date.now();
                const elapsed = now - this.lastBlockTime;
                if (elapsed < BLOCK_EXECUTION_INTERVAL_MS) {
                    await delay(BLOCK_EXECUTION_INTERVAL_MS - elapsed);
                }

                const nextJid = this.pendingBlockQueue.values().next().value;
                if (!nextJid) break;
                this.pendingBlockQueue.delete(nextJid);

                try {
                    await sock.updateBlockStatus(nextJid, 'block');
                    this.lastBlockTime = Date.now();
                    console.log(`[SECURITY_SHIELD] Successfully executed WhatsApp block for ${nextJid}`);
                } catch (err) {
                    console.error(`[SECURITY_SHIELD] Error executing updateBlockStatus for ${nextJid}:`, err);
                }
            }
        } finally {
            this.isProcessingBlockQueue = false;
        }
    }

    /**
     * Dispatches a throttled security notification to the primary owner.
     */
    private dispatchOwnerAlert(
        sock: WASocket,
        senderJid: string,
        detection: MaliciousDetectionResult,
        reason: string
    ): void {
        const ownerNumber = getPrimaryOwnerNumber();
        if (!ownerNumber) return;

        const now = Date.now();
        const alertKey = `${senderJid}_${detection.type}`;
        const lastAlert = this.recentAlerts.get(alertKey) || 0;

        if (now - lastAlert < OWNER_ALERT_COOLDOWN_MS) {
            return;
        }
        this.recentAlerts.set(alertKey, now);

        const ownerJid = `${ownerNumber}@s.whatsapp.net`;
        const alertMessage =
            `🛡️ *[SECURITY SHIELD ALERT]*\n\n` +
            `A malicious attack payload was intercepted and neutralized.\n\n` +
            `• *Sender:* ${senderJid}\n` +
            `• *Attack Type:* ${detection.type}\n` +
            `• *Severity:* ${detection.severity}\n` +
            `• *Reason:* ${reason}\n` +
            `• *Confidence:* ${(detection.confidence * 100).toFixed(0)}%\n` +
            `• *Timestamp:* ${new Date().toISOString()}`;

        sock.sendMessage(ownerJid, { text: alertMessage }).catch((err) => {
            console.error('[SECURITY_SHIELD] Failed to deliver alert to bot owner:', err);
        });
    }

    /**
     * Evicts expired entries or oldest keys when cache is full.
     */
    private evictExpiredOrOldest(): void {
        const now = Date.now();
        for (const [key, entry] of this.blacklistCache.entries()) {
            if (now > entry.expiresAt) {
                this.blacklistCache.delete(key);
            }
        }

        if (this.blacklistCache.size >= MAX_BLACKLIST_ENTRIES) {
            const deleteCount = Math.floor(MAX_BLACKLIST_ENTRIES * 0.1);
            let deleted = 0;
            for (const key of this.blacklistCache.keys()) {
                this.blacklistCache.delete(key);
                deleted++;
                if (deleted >= deleteCount) break;
            }
        }
    }
}

export const securityEnforcementService = new SecurityEnforcementService();
