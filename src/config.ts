import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface AppConfig {
    NODE_ENV: string;
    PORT: number;
    HOST: string;
    DATABASE_URL: string;
    BOT_IPC_SOCKET: string;
    INTERNAL_IPC_SECRET: string;
    JWT_SECRET: string;
    OTP_SECRET: string;
    CLOUDFLARE_TURNSTILE_SECRET_KEY: string;
    ADMIN_API_KEY: string;
    BOT_PHONE_NUMBER: string;
    SALES_PHONE_NUMBER: string;
}

export function loadConfig(): AppConfig {
    const defaultDb = path.resolve(process.cwd(), 'storage', 'database.sqlite');
    return {
        NODE_ENV: process.env.NODE_ENV || 'development',
        PORT: parseInt(process.env.PORT || '4000', 10),
        HOST: process.env.HOST || '0.0.0.0',
        DATABASE_URL: process.env.DATABASE_URL || `file:${defaultDb}`,
        BOT_IPC_SOCKET: process.env.BOT_IPC_SOCKET || process.env.IPC_SOCKET_PATH || '/app/storage/ipc.sock',
        INTERNAL_IPC_SECRET: process.env.INTERNAL_IPC_SECRET || '',
        JWT_SECRET: process.env.JWT_SECRET || 'cosmos-jwt-secret-dev-change-me',
        OTP_SECRET: process.env.OTP_SECRET || 'cosmos-dev-otp-secret-change-me',
        CLOUDFLARE_TURNSTILE_SECRET_KEY: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || '',
        ADMIN_API_KEY: process.env.ADMIN_API_KEY || '',
        BOT_PHONE_NUMBER: process.env.BOT_PHONE_NUMBER || process.env.BOT_NUMBER || '6281234567890',
        SALES_PHONE_NUMBER: process.env.SALES_PHONE_NUMBER || '6281234567890'
    };
}

export const config = loadConfig();
