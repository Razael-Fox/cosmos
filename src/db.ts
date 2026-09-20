import Database from 'better-sqlite3';
import { PrismaClient } from './generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

let prismaInstance: PrismaClient | null = null;

function ensureColumnExists(db: Database.Database, table: string, column: string, definition: string): void {
    try {
        const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
        if (!cols.some((c) => c.name === column)) {
            db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
        }
    } catch {
        /* ignore migration errors */
    }
}

export function ensureDatabaseSchema(dbPath: string): void {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const db = new Database(dbPath);
    try {
        db.pragma('foreign_keys = ON');
        db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA synchronous = NORMAL;

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
                "lid" TEXT UNIQUE,
                "pushName" TEXT,
                "username" TEXT UNIQUE,
                "email" TEXT UNIQUE,
                "passwordHash" TEXT,
                "isWhitelisted" BOOLEAN NOT NULL DEFAULT false,
                "lastLoginIp" TEXT,
                "lastLoginAt" DATETIME,
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

            CREATE TABLE IF NOT EXISTS "WhitelistedGroup" (
                "jid" TEXT NOT NULL PRIMARY KEY,
                "language" TEXT NOT NULL DEFAULT 'ID',
                "ownerJid" TEXT,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "WhitelistedGroup_ownerJid_fkey" FOREIGN KEY ("ownerJid") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "WhitelistedGroup_ownerJid_idx" ON "WhitelistedGroup"("ownerJid");

            CREATE TABLE IF NOT EXISTS "Subscription" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "userId" TEXT NOT NULL UNIQUE,
                "tier" TEXT NOT NULL DEFAULT 'FREE',
                "status" TEXT NOT NULL DEFAULT 'ACTIVE',
                "maxSubBots" INTEGER NOT NULL DEFAULT 2,
                "maxGroups" INTEGER NOT NULL DEFAULT 5,
                "customPrefix" BOOLEAN NOT NULL DEFAULT false,
                "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "expiresAt" DATETIME,
                "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );

            CREATE TABLE IF NOT EXISTS "PaymentTransaction" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "subscriptionId" TEXT NOT NULL,
                "userId" TEXT NOT NULL,
                "tier" TEXT NOT NULL,
                "amount" BIGINT NOT NULL,
                "status" TEXT NOT NULL DEFAULT 'PAID',
                "paymentMethod" TEXT NOT NULL DEFAULT 'MANUAL_WHATSAPP',
                "confirmedBy" TEXT,
                "orderRef" TEXT UNIQUE,
                "notes" TEXT,
                "paidAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "PaymentTransaction_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT "PaymentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "PaymentTransaction_userId_idx" ON "PaymentTransaction"("userId");
            CREATE INDEX IF NOT EXISTS "PaymentTransaction_status_idx" ON "PaymentTransaction"("status");

            CREATE TABLE IF NOT EXISTS "OtpVerification" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "phoneNumber" TEXT NOT NULL,
                "userJid" TEXT,
                "codeHash" TEXT NOT NULL,
                "salt" TEXT NOT NULL,
                "lookupHash" TEXT,
                "metadata" TEXT,
                "regSessionId" TEXT UNIQUE,
                "purpose" TEXT NOT NULL DEFAULT 'REGISTRATION',
                "attempts" INTEGER NOT NULL DEFAULT 0,
                "maxAttempts" INTEGER NOT NULL DEFAULT 3,
                "expiresAt" DATETIME NOT NULL,
                "isUsed" BOOLEAN NOT NULL DEFAULT false,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "OtpVerification_userJid_fkey" FOREIGN KEY ("userJid") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "OtpVerification_phoneNumber_purpose_isUsed_idx" ON "OtpVerification"("phoneNumber", "purpose", "isUsed");
            CREATE INDEX IF NOT EXISTS "OtpVerification_regSessionId_idx" ON "OtpVerification"("regSessionId");

            CREATE TABLE IF NOT EXISTS "WebSession" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "userId" TEXT NOT NULL,
                "tokenHash" TEXT NOT NULL UNIQUE,
                "ipAddress" TEXT,
                "userAgent" TEXT,
                "expiresAt" DATETIME NOT NULL,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "WebSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "WebSession_userId_idx" ON "WebSession"("userId");

            CREATE TABLE IF NOT EXISTS "UserDevice" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "userId" TEXT NOT NULL,
                "deviceTokenHash" TEXT NOT NULL,
                "lastIpAddress" TEXT NOT NULL,
                "userAgent" TEXT NOT NULL,
                "deviceType" TEXT,
                "browser" TEXT,
                "os" TEXT,
                "country" TEXT,
                "city" TEXT,
                "isTrusted" BOOLEAN NOT NULL DEFAULT false,
                "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT "UserDevice_userId_deviceTokenHash_key" UNIQUE ("userId", "deviceTokenHash")
            );
            CREATE INDEX IF NOT EXISTS "UserDevice_userId_isTrusted_idx" ON "UserDevice"("userId", "isTrusted");
            CREATE INDEX IF NOT EXISTS "UserDevice_lastIpAddress_idx" ON "UserDevice"("lastIpAddress");

            CREATE TABLE IF NOT EXISTS "UserIpAccessLog" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "userId" TEXT,
                "ipAddress" TEXT NOT NULL,
                "country" TEXT,
                "userAgent" TEXT,
                "action" TEXT NOT NULL,
                "status" TEXT NOT NULL,
                "details" TEXT,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "UserIpAccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "UserIpAccessLog_userId_createdAt_idx" ON "UserIpAccessLog"("userId", "createdAt");
            CREATE INDEX IF NOT EXISTS "UserIpAccessLog_ipAddress_createdAt_idx" ON "UserIpAccessLog"("ipAddress", "createdAt");
            CREATE INDEX IF NOT EXISTS "UserIpAccessLog_action_status_idx" ON "UserIpAccessLog"("action", "status");

            CREATE TABLE IF NOT EXISTS "SubBotInstance" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "ownerJid" TEXT NOT NULL,
                "customPrefix" TEXT NOT NULL DEFAULT '.',
                "status" TEXT NOT NULL DEFAULT 'ACTIVE',
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "SubBotInstance_ownerJid_fkey" FOREIGN KEY ("ownerJid") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "SubBotInstance_ownerJid_idx" ON "SubBotInstance"("ownerJid");
        `);

        ensureColumnExists(db, 'User', 'currentJobId', 'INTEGER');
        ensureColumnExists(db, 'User', 'lastWorkedAt', 'DATETIME');
        ensureColumnExists(db, 'User', 'email', 'TEXT');
        ensureColumnExists(db, 'User', 'passwordHash', 'TEXT');
        ensureColumnExists(db, 'User', 'isWhitelisted', 'BOOLEAN NOT NULL DEFAULT false');
        ensureColumnExists(db, 'User', 'lastLoginIp', 'TEXT');
        ensureColumnExists(db, 'User', 'lastLoginAt', 'DATETIME');
        ensureColumnExists(db, 'OtpVerification', 'lookupHash', 'TEXT');
        try {
            db.exec(`CREATE INDEX IF NOT EXISTS "OtpVerification_lookupHash_idx" ON "OtpVerification"("lookupHash")`);
        } catch {
            /* ignore index errors */
        }
        ensureColumnExists(db, 'WhitelistedGroup', 'ownerJid', 'TEXT');
        ensureColumnExists(db, 'WhitelistedGroup', 'createdAt', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
        ensureColumnExists(db, 'IdCard', 'bloodType', "TEXT NOT NULL DEFAULT 'O'");
        ensureColumnExists(db, 'IdCard', 'rtRw', "TEXT NOT NULL DEFAULT '001/002'");
        ensureColumnExists(db, 'IdCard', 'village', "TEXT NOT NULL DEFAULT 'Sukajadi'");
        ensureColumnExists(db, 'IdCard', 'district', "TEXT NOT NULL DEFAULT 'Sukajadi'");
        ensureColumnExists(db, 'IdCard', 'city', "TEXT NOT NULL DEFAULT 'BANDUNG'");
        ensureColumnExists(db, 'IdCard', 'provinsi', "TEXT NOT NULL DEFAULT 'JAWA BARAT'");
    } catch (err) {
        console.error(`[DB] Error ensuring database schema at ${dbPath}:`, err);
    } finally {
        db.close();
    }
}

export function getDatabasePath(): string {
    const rawUrl = config.DATABASE_URL;
    return rawUrl.replace(/^file:/, '');
}

export function getPrismaClient(): PrismaClient {
    if (prismaInstance) return prismaInstance;

    const dbPath = getDatabasePath();
    ensureDatabaseSchema(dbPath);

    const adapter = new PrismaBetterSqlite3({ url: dbPath });
    prismaInstance = new PrismaClient({ adapter });
    return prismaInstance;
}

export const prisma = getPrismaClient();
