import Database from 'better-sqlite3';
import { PrismaClient } from './generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { AsyncLocalStorage } from 'async_hooks';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

export const dbContext = new AsyncLocalStorage<{ sessionId: string; prisma: PrismaClient }>();
export const clients = new Map<string, PrismaClient>();

export function ensureDatabaseSchema(dbPath: string): void {
    const db = new Database(dbPath);
    try {
        db.pragma('foreign_keys = ON');
        db.exec(`
            CREATE TABLE IF NOT EXISTS "WhatsAppAuth" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "value" TEXT NOT NULL,
                "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS "WhitelistedGroup" (
                "jid" TEXT NOT NULL PRIMARY KEY,
                "language" TEXT NOT NULL DEFAULT 'ID'
            );

            CREATE TABLE IF NOT EXISTS "TelegramPrivateChat" (
                "chatId" TEXT NOT NULL PRIMARY KEY,
                "title" TEXT,
                "inviteLink" TEXT,
                "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS "ActiveSession" (
                "feature" TEXT NOT NULL,
                "jid" TEXT NOT NULL,
                "metadata" TEXT,
                "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY ("feature", "jid")
            );

            CREATE TABLE IF NOT EXISTS "AiChatSession" (
                "jid" TEXT NOT NULL PRIMARY KEY,
                "summary" TEXT NOT NULL DEFAULT '',
                "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS "AiChatMessage" (
                "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "jid" TEXT NOT NULL,
                "role" TEXT NOT NULL,
                "content" TEXT NOT NULL,
                "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "AiChatMessage_jid_fkey" FOREIGN KEY ("jid") REFERENCES "AiChatSession" ("jid") ON DELETE CASCADE ON UPDATE CASCADE
            );

            CREATE TABLE IF NOT EXISTS "AutoDlSetting" (
                "jid" TEXT NOT NULL,
                "platform" TEXT NOT NULL,
                "enabled" BOOLEAN NOT NULL DEFAULT true,
                "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY ("jid", "platform")
            );

            CREATE TABLE IF NOT EXISTS "ScheduledDeletion" (
                "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "jid" TEXT NOT NULL,
                "msgId" TEXT NOT NULL,
                "fromMe" BOOLEAN NOT NULL,
                "deleteAt" DATETIME NOT NULL,
                "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "ScheduledDeletion_jid_msgId_key" ON "ScheduledDeletion"("jid", "msgId");

            CREATE TABLE IF NOT EXISTS "JobCatalog" (
                "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "name" TEXT NOT NULL,
                "description" TEXT NOT NULL,
                "baseSalary" BIGINT NOT NULL,
                "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
                "requiredItemId" TEXT,
                "isActive" BOOLEAN NOT NULL DEFAULT true
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "JobCatalog_name_key" ON "JobCatalog"("name");

            CREATE TABLE IF NOT EXISTS "User" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "lid" TEXT,
                "pushName" TEXT,
                "username" TEXT,
                "language" TEXT NOT NULL DEFAULT 'ID',
                "balance" BIGINT NOT NULL DEFAULT 10000,
                "lastDailyClaim" DATETIME,
                "lastGambleAt" DATETIME,
                "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
                "totalWins" INTEGER NOT NULL DEFAULT 0,
                "totalLosses" INTEGER NOT NULL DEFAULT 0,
                "rouletteRounds" INTEGER NOT NULL DEFAULT 0,
                "rouletteWins" INTEGER NOT NULL DEFAULT 0,
                "rouletteKills" INTEGER NOT NULL DEFAULT 0,
                "rouletteAfk" INTEGER NOT NULL DEFAULT 0,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "creditScore" INTEGER NOT NULL DEFAULT 500,
                "currentJobId" INTEGER,
                "lastWorkedAt" DATETIME,
                CONSTRAINT "User_currentJobId_fkey" FOREIGN KEY ("currentJobId") REFERENCES "JobCatalog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "User_lid_key" ON "User"("lid");
            CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

            CREATE TABLE IF NOT EXISTS "HouseVault" (
                "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
                "income" BIGINT NOT NULL DEFAULT 0,
                "payout" BIGINT NOT NULL DEFAULT 0,
                "netProfit" BIGINT NOT NULL DEFAULT 0,
                "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS "ExchangeRateLog" (
                "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "rate" REAL NOT NULL,
                "source" TEXT NOT NULL,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS "EconomyMultiplier" (
                "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                "multiplier" REAL NOT NULL,
                "reasoning" TEXT,
                "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS "PropertyCatalog" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "name" TEXT NOT NULL,
                "typeCategory" TEXT NOT NULL,
                "basePrice" BIGINT NOT NULL,
                "baseDepreciationRate" REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS "Item" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "shortId" TEXT NOT NULL,
                "name" TEXT NOT NULL,
                "description" TEXT NOT NULL,
                "price" BIGINT NOT NULL,
                "type" TEXT NOT NULL,
                "isAvailable" BOOLEAN NOT NULL DEFAULT true
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "Item_shortId_key" ON "Item"("shortId");

            CREATE TABLE IF NOT EXISTS "UserInventory" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "userId" TEXT NOT NULL,
                "itemId" TEXT,
                "quantity" INTEGER NOT NULL DEFAULT 1,
                "propertyId" TEXT,
                "name" TEXT,
                "typeCategory" TEXT,
                "originalPrice" BIGINT,
                "ownershipStatus" TEXT NOT NULL DEFAULT 'Owned',
                "purchaseDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "UserInventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT "UserInventory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT "UserInventory_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "PropertyCatalog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "UserInventory_userId_itemId_key" ON "UserInventory"("userId", "itemId");

            CREATE TABLE IF NOT EXISTS "PropertyTransaction" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "userId" TEXT NOT NULL,
                "propertyId" TEXT NOT NULL,
                "transactionType" TEXT NOT NULL,
                "amount" BIGINT NOT NULL,
                "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "aiNegotiationLog" TEXT,
                CONSTRAINT "PropertyTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT "PropertyTransaction_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "PropertyCatalog" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
            );

            CREATE TABLE IF NOT EXISTS "IdCard" (
                "nik" TEXT NOT NULL PRIMARY KEY,
                "userJid" TEXT NOT NULL,
                "fullName" TEXT NOT NULL,
                "placeOfBirth" TEXT NOT NULL,
                "dateOfBirth" TEXT NOT NULL,
                "gender" TEXT NOT NULL,
                "address" TEXT NOT NULL,
                "religion" TEXT NOT NULL,
                "maritalStatus" TEXT NOT NULL,
                "occupation" TEXT NOT NULL,
                "citizenship" TEXT NOT NULL DEFAULT 'WNI',
                "validUntil" TEXT NOT NULL DEFAULT 'SEUMUR HIDUP',
                "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "IdCard_userJid_fkey" FOREIGN KEY ("userJid") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IdCard_userJid_key" ON "IdCard"("userJid");

            CREATE TABLE IF NOT EXISTS "BankAccount" (
                "accountNumber" TEXT NOT NULL PRIMARY KEY,
                "userJid" TEXT NOT NULL,
                "balance" BIGINT NOT NULL DEFAULT 0,
                "status" TEXT NOT NULL DEFAULT 'ACTIVE',
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "BankAccount_userJid_fkey" FOREIGN KEY ("userJid") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "BankAccount_userJid_key" ON "BankAccount"("userJid");

            CREATE TABLE IF NOT EXISTS "BankTransaction" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "accountNumber" TEXT NOT NULL,
                "type" TEXT NOT NULL,
                "amount" BIGINT NOT NULL,
                "description" TEXT,
                "relatedAccount" TEXT,
                "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "BankTransaction_accountNumber_fkey" FOREIGN KEY ("accountNumber") REFERENCES "BankAccount" ("accountNumber") ON DELETE CASCADE ON UPDATE CASCADE
            );

            CREATE TABLE IF NOT EXISTS "Loan" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "userId" TEXT NOT NULL,
                "principalAmount" BIGINT NOT NULL,
                "interestRate" REAL NOT NULL,
                "dueDate" DATETIME NOT NULL,
                "status" TEXT NOT NULL DEFAULT 'ACTIVE',
                "collateralItems" TEXT,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "Loan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "Loan_userId_idx" ON "Loan"("userId");
            CREATE INDEX IF NOT EXISTS "Loan_status_idx" ON "Loan"("status");

            CREATE TABLE IF NOT EXISTS "ActivityLog" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "userId" TEXT NOT NULL,
                "type" TEXT NOT NULL,
                "amount" BIGINT,
                "description" TEXT,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "ActivityLog_userId_idx" ON "ActivityLog"("userId");
            CREATE INDEX IF NOT EXISTS "ActivityLog_type_idx" ON "ActivityLog"("type");
            CREATE INDEX IF NOT EXISTS "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

            CREATE TABLE IF NOT EXISTS "LoanReminder" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "loanId" TEXT NOT NULL,
                "userJid" TEXT NOT NULL,
                "chatJid" TEXT,
                "remindAt" DATETIME NOT NULL,
                "sent" BOOLEAN NOT NULL DEFAULT false,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "LoanReminder_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "LoanReminder_loanId_idx" ON "LoanReminder"("loanId");
            CREATE INDEX IF NOT EXISTS "LoanReminder_remindAt_sent_idx" ON "LoanReminder"("remindAt", "sent");
        `);
    } catch (err) {
        console.error(`[DB] Error ensuring database schema at ${dbPath}:`, err);
    } finally {
        db.close();
    }
}

export function getPrismaClient(sessionId: string = 'default'): PrismaClient {
    if (clients.has(sessionId)) return clients.get(sessionId)!;

    let targetDbPath: string;

    if (sessionId === 'default') {
        targetDbPath = process.env.DATABASE_URL?.replace('file:', '') || './storage/database.sqlite';
        const parsed = path.parse(targetDbPath);
        if (!fs.existsSync(parsed.dir)) {
            fs.mkdirSync(parsed.dir, { recursive: true });
        }
        ensureDatabaseSchema(targetDbPath);
    } else {
        const phoneNumber = sessionId.replace(/^sub_/, '');
        const botDir = path.resolve(process.cwd(), 'database', phoneNumber);

        if (!fs.existsSync(botDir)) {
            fs.mkdirSync(botDir, { recursive: true });
        }

        targetDbPath = path.join(botDir, 'database.sqlite');

        if (!fs.existsSync(targetDbPath)) {
            const templateDb =
                process.env.DATABASE_URL?.replace('file:', '') ||
                path.resolve(process.cwd(), 'storage', 'database.sqlite');
            if (fs.existsSync(templateDb)) {
                fs.copyFileSync(templateDb, targetDbPath);
                try {
                    const db = new Database(targetDbPath);
                    db.exec(`
                        DELETE FROM WhatsAppAuth;
                        DELETE FROM ScheduledDeletion;
                        DELETE FROM ActiveSession;
                        DELETE FROM AiChatMessage;
                        DELETE FROM AiChatSession;
                        DELETE FROM PropertyTransaction;
                        DELETE FROM BankTransaction;
                        DELETE FROM Loan;
                        DELETE FROM ActivityLog;
                        DELETE FROM UserInventory;
                        DELETE FROM IdCard;
                        DELETE FROM BankAccount;
                        DELETE FROM User;
                        DELETE FROM WhitelistedGroup;
                    `);
                    db.close();
                    console.log(`[DB] Created isolated database for sub-bot session: ${sessionId}`);
                } catch (err) {
                    console.error(`[DB] Failed to wipe template data for sub-bot ${sessionId}:`, err);
                }
            } else {
                ensureDatabaseSchema(targetDbPath);
                console.log(`[DB] Initialized new isolated database schema for sub-bot session: ${sessionId}`);
            }
        }
    }

    const adapter = new PrismaBetterSqlite3({ url: targetDbPath });
    const client = new PrismaClient({ adapter });
    clients.set(sessionId, client);
    return client;
}

export async function disconnectPrismaClient(sessionId: string): Promise<void> {
    const client = clients.get(sessionId);
    if (client) {
        try {
            await client.$disconnect();
        } catch (e) {
            console.error(`[DB] Error disconnecting client for session ${sessionId}:`, e);
        }
        clients.delete(sessionId);
    }
}

const defaultClient = getPrismaClient('default');

export const prisma = new Proxy(defaultClient, {
    get(target, prop, receiver) {
        const store = dbContext.getStore();
        if (store && store.prisma) {
            return Reflect.get(store.prisma, prop, receiver);
        }
        return Reflect.get(target, prop, receiver);
    }
});

export async function addGroup(jid: string): Promise<boolean> {
    try {
        await prisma.whitelistedGroup.upsert({
            where: { jid },
            update: {},
            create: { jid }
        });
        return true;
    } catch (err) {
        console.error('Error adding group:', err);
        return false;
    }
}

export async function isGroupWhitelisted(jid: string): Promise<boolean> {
    try {
        const group = await prisma.whitelistedGroup.findUnique({
            where: { jid }
        });
        return !!group;
    } catch {
        return false;
    }
}

export async function getAllWhitelistedGroups(): Promise<string[]> {
    try {
        const groups = await prisma.whitelistedGroup.findMany();
        return groups.map((g: any) => g.jid);
    } catch {
        return [];
    }
}

// --- Telegram Private Chat Registry ---

export interface TelegramPrivateChatInfo {
    chatId: string;
    title: string | null;
    inviteLink: string | null;
}

/**
 * Registers a private Telegram chat so the bot is allowed to proxy its media.
 */
export async function addTelegramPrivateChat(
    chatId: string,
    title?: string | null,
    inviteLink?: string | null
): Promise<boolean> {
    try {
        await prisma.telegramPrivateChat.upsert({
            where: { chatId },
            update: {
                ...(title !== undefined ? { title } : {}),
                ...(inviteLink !== undefined ? { inviteLink } : {})
            },
            create: { chatId, title: title ?? null, inviteLink: inviteLink ?? null }
        });
        return true;
    } catch (err) {
        console.error('[DB] Error adding Telegram private chat:', err);
        return false;
    }
}

/**
 * Checks whether a private Telegram chat (by internal numeric chat id) has been registered.
 */
export async function isTelegramChatRegistered(chatId: string): Promise<boolean> {
    try {
        const chat = await prisma.telegramPrivateChat.findUnique({ where: { chatId } });
        return !!chat;
    } catch {
        return false;
    }
}

export async function getTelegramPrivateChat(chatId: string): Promise<TelegramPrivateChatInfo | null> {
    try {
        const chat = await prisma.telegramPrivateChat.findUnique({ where: { chatId } });
        if (!chat) return null;
        return { chatId: chat.chatId, title: chat.title, inviteLink: chat.inviteLink };
    } catch {
        return null;
    }
}

export async function listTelegramPrivateChats(): Promise<TelegramPrivateChatInfo[]> {
    try {
        const chats = await prisma.telegramPrivateChat.findMany({ orderBy: { added_at: 'asc' } });
        return chats.map((c: any) => ({ chatId: c.chatId, title: c.title, inviteLink: c.inviteLink }));
    } catch {
        return [];
    }
}

export async function removeTelegramPrivateChat(chatId: string): Promise<boolean> {
    try {
        await prisma.telegramPrivateChat.delete({ where: { chatId } });
        return true;
    } catch {
        return false;
    }
}

/**
 * Looks up a registered private Telegram chat by an invite hash
 * (the part after t.me/+ or t.me/joinchat/).
 */
export async function findTelegramChatByInviteLink(inviteHash: string): Promise<TelegramPrivateChatInfo | null> {
    try {
        const chat = await prisma.telegramPrivateChat.findFirst({
            where: { inviteLink: { contains: inviteHash } }
        });
        if (!chat) return null;
        return { chatId: chat.chatId, title: chat.title, inviteLink: chat.inviteLink };
    } catch {
        return null;
    }
}
