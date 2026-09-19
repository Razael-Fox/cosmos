import type { User } from '../generated/prisma/client.js';

export interface UserProfile {
    id: string;
    lid?: string | null;
    pushName?: string | null;
    username?: string | null;
    email?: string | null;
    isWhitelisted: boolean;
    language: 'ID' | 'EN';
    balance: string;
    creditScore: number;
    lastLoginIp?: string | null;
    lastLoginAt?: string | null;
    createdAt: string;
    profilePictureUrl?: string | null;
}

export function serializeUser(user: User, profilePictureUrl?: string | null): UserProfile {
    return {
        id: user.id,
        lid: user.lid ?? null,
        pushName: user.pushName ?? null,
        username: user.username || user.pushName || null,
        email: user.email ?? null,
        isWhitelisted: user.isWhitelisted,
        language: (user.language as 'ID' | 'EN') || 'ID',
        balance: user.balance.toString(),
        creditScore: user.creditScore,
        lastLoginIp: user.lastLoginIp ?? null,
        lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
        createdAt: user.createdAt.toISOString(),
        profilePictureUrl: profilePictureUrl ?? null
    };
}
