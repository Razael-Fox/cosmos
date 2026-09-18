/**
 * Shared API and model types for the Cosmos Web Portal.
 * Designed against the Fastify API contract specified in Issue #18 & Issue #21.
 */

export interface UserProfile {
    id: string; // WhatsApp JID (e.g. 628123456789@s.whatsapp.net)
    lid?: string | null;
    pushName?: string | null;
    username?: string | null;
    email?: string | null;
    isWhitelisted: boolean;
    language: 'ID' | 'EN';
    balance: string | number;
    creditScore: number;
    lastLoginIp?: string | null;
    lastLoginAt?: string | null;
    createdAt: string;
}

export interface RegisterInvertedRequest {
    phone: string;
    username?: string;
    email?: string;
    password?: string;
    turnstileToken: string;
}

export interface RegisterInvertedResponse {
    token: string; // Opaque string formatted as COSMOS-XXXXXX-<last4>
    clickToChatUrl: string;
    regSessionId: string;
    expiresIn: number; // in seconds
}

export interface RegisterDirectRequest {
    phone: string;
    username?: string;
    email?: string;
    password?: string;
    turnstileToken: string;
}

export interface RegisterDirectResponse {
    expiresIn: number;
    message?: string;
}

export interface VerifyOtpRequest {
    phone: string;
    otp: string;
}

export interface VerifyOtpResponse {
    jwtToken: string;
    user: UserProfile;
}

export interface ResendOtpRequest {
    phone: string;
    turnstileToken: string;
}

export interface ResendOtpResponse {
    expiresIn: number;
    message?: string;
}

export interface LoginRequest {
    identifier: string; // WhatsApp Phone Number or Username
    password: string;
}

export interface LoginResponse {
    jwtToken: string;
    user: UserProfile;
}

export type SubscriptionTier = 'FREE' | 'SUBSIDIZED' | 'PARTNER';
export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'GRACE_PERIOD';

export interface SubscriptionStatusResponse {
    tier: SubscriptionTier;
    status: SubscriptionStatus;
    maxSubBots: number;
    maxGroups: number;
    customPrefix: boolean;
    startedAt: string;
    expiresAt?: string | null;
    currentSubBots: number;
    currentGroups: number;
}

export interface SalesLinkResponse {
    salesUrl: string;
    orderRef: string;
}

export interface SubBotInstance {
    id: string; // Clean phone number (e.g. "628987654321")
    ownerJid: string;
    customPrefix: string;
    status: 'ACTIVE' | 'PAUSED' | 'DISCONNECTED';
    createdAt: string;
    updatedAt: string;
}

export interface PairSubBotRequest {
    phone: string;
    method: 'code' | 'qr';
}

export interface PairSubBotResponse {
    pairingCode?: string;
    qrCode?: string;
    expiresIn: number; // seconds
}

export interface WhitelistedGroup {
    jid: string;
    language: string;
    ownerJid?: string | null;
    createdAt: string;
}

export interface AddGroupRequest {
    jid: string;
    language?: string;
}

export interface AuthStatusWsMessage {
    status: 'VERIFIED' | 'EXPIRED' | 'FAILED';
    jwtToken?: string;
    user?: UserProfile;
    error?: string;
}

export interface ParticipatingGroup {
    id: string;
    subject: string;
    size: number;
    desc?: string;
    isAdmin?: boolean;
    isWhitelisted: boolean;
}

export interface ParticipatingGroupsResponse {
    groups: ParticipatingGroup[];
    quota: {
        current: number;
        max: number;
        available: number;
        tier: string;
        isLimitReached: boolean;
    };
}

