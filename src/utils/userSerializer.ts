import type { User } from '../generated/prisma/client.js';

const DICEBEAR_BASE_URL = 'https://api.dicebear.com/10.x';
const AVATAR_STYLE = 'thumbs';

function buildAvatarPlaceholderUrl(seed: string): string {
    return `${DICEBEAR_BASE_URL}/${AVATAR_STYLE}/svg?seed=${encodeURIComponent(seed)}`;
}

function getAvatarPlaceholderUrl(nik: string | null | undefined, jidOrPhone: string): string {
    const phoneDigits = jidOrPhone.split('@')[0].replace(/\D/g, '');
    const seed = nik && nik.trim() ? nik.trim() : phoneDigits;
    return buildAvatarPlaceholderUrl(seed);
}

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
    coverPictureUrl?: string | null;
    avatarPlaceholderUrl: string;
    presence?: 'online' | 'offline' | null;
}

export function serializeUser(
    user: User,
    profilePictureUrl?: string | null,
    presence?: 'online' | 'offline' | null,
    nik?: string | null,
    coverPictureUrl?: string | null
): UserProfile {
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
        profilePictureUrl: profilePictureUrl ?? null,
        coverPictureUrl: coverPictureUrl ?? null,
        avatarPlaceholderUrl: getAvatarPlaceholderUrl(nik, user.id),
        presence: presence ?? null
    };
}
