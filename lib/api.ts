import type {
    RegisterInvertedRequest,
    RegisterInvertedResponse,
    RegisterDirectRequest,
    RegisterDirectResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
    ResendOtpRequest,
    ResendOtpResponse,
    LoginRequest,
    LoginResponse,
    SubscriptionStatusResponse,
    SalesLinkResponse,
    SubBotInstance,
    PairSubBotRequest,
    PairSubBotResponse,
    WhitelistedGroup,
    AddGroupRequest,
    SubscriptionTier,
    AuthStatusWsMessage,
    ParticipatingGroupsResponse,
    SystemStatusResponse
} from './types';

export function getApiBaseUrl(): string {
    const envUrl = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');
    if (typeof window !== 'undefined') {
        // If client is accessed via a non-localhost host (e.g. mobile IP or remote domain),
        // but envUrl points to localhost, fall back to relative URL ("") so the browser
        // requests the server hosting the app rather than localhost on the client's device.
        const isClientLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (!isClientLocalhost && (envUrl.includes('localhost') || envUrl.includes('127.0.0.1'))) {
            return '';
        }
    }
    return envUrl;
}

const TOKEN_STORAGE_KEY = 'cosmos_jwt_token';
const USER_STORAGE_KEY = 'cosmos_user_profile';

export class ApiError extends Error {
    public status: number;
    public data: Record<string, unknown>;

    constructor(message: string, status: number, data: Record<string, unknown>) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data;
    }
}

/**
 * Retrieves the stored JWT authentication token from localStorage.
 */
export function getStoredToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_STORAGE_KEY);
}

/**
 * Stores the JWT authentication token in localStorage.
 */
export function setStoredToken(token: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    window.dispatchEvent(new Event('storage'));
}

/**
 * Retrieves the stored user profile from localStorage.
 */
export function getStoredUser(): import('./types').UserProfile | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as import('./types').UserProfile;
    } catch {
        return null;
    }
}

/**
 * Stores the user profile in localStorage.
 */
export function setStoredUser(user: import('./types').UserProfile): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    window.dispatchEvent(new Event('storage'));
}

/**
 * Clears the stored JWT authentication token and profile from localStorage.
 */
export function clearStoredToken(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    window.dispatchEvent(new Event('storage'));
}

/**
 * Low-level typed HTTP client for Cosmos API endpoints.
 */
async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = getStoredToken();
    const headers: Record<string, string> = {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers as Record<string, string>)
    };

    if (token && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    const response = await fetch(url, {
        ...options,
        headers
    });

    if (!response.ok) {
        let errorData: Record<string, unknown>;
        try {
            errorData = (await response.json()) as Record<string, unknown>;
        } catch {
            errorData = { message: response.statusText || 'Network request failed' };
        }
        const message =
            typeof errorData.message === 'string'
                ? errorData.message
                : typeof errorData.error === 'string'
                  ? errorData.error
                  : `HTTP error ${response.status}`;
        throw new ApiError(message, response.status, errorData);
    }

    return response.json() as Promise<T>;
}

// -------------------------------------------------------------
// Authentication Endpoints
// -------------------------------------------------------------

/**
 * POST /api/v1/auth/register-inverted
 * Generates an opaque verification token and WhatsApp Click-to-Chat URL.
 */
export async function registerInverted(payload: RegisterInvertedRequest): Promise<RegisterInvertedResponse> {
    return request<RegisterInvertedResponse>('/api/v1/auth/register-inverted', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

/**
 * POST /api/v1/auth/register-direct
 * Direct OTP dispatch gated strictly by Cloudflare Turnstile token validation.
 */
export async function registerDirect(payload: RegisterDirectRequest): Promise<RegisterDirectResponse> {
    return request<RegisterDirectResponse>('/api/v1/auth/register-direct', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

/**
 * POST /api/v1/auth/verify-otp
 * Verifies submitted 6-digit OTP and returns authenticated JWT token.
 */
export async function verifyOtp(payload: VerifyOtpRequest): Promise<VerifyOtpResponse> {
    const res = await request<VerifyOtpResponse>('/api/v1/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (res.jwtToken) {
        setStoredToken(res.jwtToken);
    }
    if (res.user) {
        setStoredUser(res.user);
    }
    return res;
}

/**
 * POST /api/v1/auth/resend-otp
 * Requests a new OTP with Turnstile challenge.
 */
export async function resendOtp(payload: ResendOtpRequest): Promise<ResendOtpResponse> {
    return request<ResendOtpResponse>('/api/v1/auth/resend-otp', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

/**
 * POST /api/v1/auth/login
 * Standard password login for already whitelisted accounts.
 */
export async function login(payload: LoginRequest): Promise<LoginResponse> {
    const res = await request<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    if (res.jwtToken) {
        setStoredToken(res.jwtToken);
    }
    if (res.user) {
        setStoredUser(res.user);
    }
    return res;
}

/**
 * GET /api/v1/auth/me
 * Retrieves the latest profile of the currently authenticated user.
 */
export async function getUserProfile(): Promise<{ user: import('./types').UserProfile }> {
    const res = await request<{ user: import('./types').UserProfile }>('/api/v1/auth/me', {
        method: 'GET'
    });
    if (res.user) {
        setStoredUser(res.user);
    }
    return res;
}

/**
 * GET /api/v1/auth/profile-photo
 * Retrieves the profile picture URL for the authenticated user from WhatsApp Baileys engine.
 */
export async function getProfilePhoto(): Promise<{ pictureUrl: string | null; coverUrl?: string | null }> {
    return await request<{ pictureUrl: string | null; coverUrl?: string | null }>('/api/v1/auth/profile-photo', {
        method: 'GET'
    });
}

/**
 * GET /api/v1/auth/presence
 * Retrieves the live presence status ('online' | 'offline') of the authenticated user.
 */
export async function getUserPresence(): Promise<{ presence: 'online' | 'offline'; lastSeen?: number | null }> {
    return await request<{ presence: 'online' | 'offline'; lastSeen?: number | null }>('/api/v1/auth/presence', {
        method: 'GET'
    });
}

// -------------------------------------------------------------
// Subscriptions & Pricing Endpoints
// -------------------------------------------------------------

/**
 * GET /api/v1/subscriptions/sales-link
 * Generates dynamic sales representative WhatsApp link with prefilled plan and order ref.
 */
export async function getSalesLink(tier: SubscriptionTier, phone?: string): Promise<SalesLinkResponse> {
    const params = new URLSearchParams({ tier });
    if (phone) params.set('phone', phone);
    return request<SalesLinkResponse>(`/api/v1/subscriptions/sales-link?${params.toString()}`, {
        method: 'GET'
    });
}

/**
 * GET /api/v1/subscriptions/status
 * Fetches current tier, expiration, and quota usage for authenticated user.
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatusResponse> {
    return request<SubscriptionStatusResponse>('/api/v1/subscriptions/status', {
        method: 'GET'
    });
}

// -------------------------------------------------------------
// Whitelisted Groups Endpoints
// -------------------------------------------------------------

/**
 * GET /api/v1/groups
 * Retrieves all whitelisted groups owned by authenticated user.
 */
export async function listGroups(): Promise<WhitelistedGroup[]> {
    return request<WhitelistedGroup[]>('/api/v1/groups', {
        method: 'GET'
    });
}

/**
 * GET /api/v1/groups/participating
 * Retrieves all participating WhatsApp groups discovered from user's account via IPC.
 */
export async function listParticipatingGroups(): Promise<ParticipatingGroupsResponse> {
    return request<ParticipatingGroupsResponse>('/api/v1/groups/participating', {
        method: 'GET'
    });
}

/**
 * POST /api/v1/groups/whitelist
 * Adds a new whitelisted group, gated strictly by QuotaService.
 */
export async function addGroup(payload: AddGroupRequest): Promise<WhitelistedGroup> {
    return request<WhitelistedGroup>('/api/v1/groups/whitelist', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

/**
 * DELETE /api/v1/groups/:jid
 * Removes whitelisted group with strict IDOR tenant isolation.
 */
export async function deleteGroup(jid: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/v1/groups/${encodeURIComponent(jid)}`, {
        method: 'DELETE'
    });
}

// -------------------------------------------------------------
// Sub-Bot Lifecycle & Pairing Endpoints
// -------------------------------------------------------------

/**
 * POST /api/v1/subbots/pair
 * Initiates pairing session with code or QR method.
 */
export async function pairSubBot(payload: PairSubBotRequest): Promise<PairSubBotResponse> {
    return request<PairSubBotResponse>('/api/v1/subbots/pair', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

/**
 * GET /api/v1/subbots/list
 * Returns active and registered sub-bots owned by authenticated user.
 */
export async function listSubBots(): Promise<SubBotInstance[]> {
    return request<SubBotInstance[]>('/api/v1/subbots/list', {
        method: 'GET'
    });
}

/**
 * DELETE /api/v1/subbots/:phone
 * Disconnects and removes sub-bot instance.
 */
export async function deleteSubBot(phone: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/api/v1/subbots/${encodeURIComponent(phone)}`, {
        method: 'DELETE'
    });
}

// -------------------------------------------------------------
// Real-Time WebSockets
// -------------------------------------------------------------

function getWebSocketUrl(pathWithQuery: string): string {
    const baseUrl = getApiBaseUrl();
    const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    const wsProtocol = origin.startsWith('https') ? 'wss:' : 'ws:';
    let cleanHost = origin.replace(/^https?:\/\//, '');

    // In local dev where Next.js runs on 3000 and Fastify runs on 4000,
    // point WebSocket directly to API port 4000 if connecting to port 3000
    if (cleanHost.includes(':3000')) {
        cleanHost = cleanHost.replace(':3000', ':4000');
    }

    const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
    return `${wsProtocol}//${cleanHost}${path}`;
}

export function createAuthStatusWebSocket(
    regSessionId: string,
    onMessage: (msg: AuthStatusWsMessage) => void,
    onError?: (err: unknown) => void
): () => void {
    let isClosed = false;
    let ws: WebSocket | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let initialPollTimeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
        isClosed = true;
        if (ws) {
            try {
                ws.close();
            } catch (wsErr) {
                void wsErr;
            }
            ws = null;
        }
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        if (initialPollTimeout) {
            clearTimeout(initialPollTimeout);
            initialPollTimeout = null;
        }
    };

    const handleSuccess = (msg: AuthStatusWsMessage) => {
        if (msg.jwtToken) setStoredToken(msg.jwtToken);
        if (msg.user) setStoredUser(msg.user);
        onMessage(msg);
        cleanup();
    };

    const checkStatus = async () => {
        if (isClosed) return;
        try {
            const check = await request<AuthStatusWsMessage>(
                `/api/v1/auth/status?session=${encodeURIComponent(regSessionId)}`
            );
            if (check) {
                if (check.status === 'VERIFIED') {
                    handleSuccess(check);
                } else if (check.status === 'EXPIRED' || check.status === 'FAILED') {
                    onMessage(check);
                    cleanup();
                }
            }
        } catch (pollErr) {
            void pollErr;
        }
    };

    // Fast polling starts immediately alongside WebSocket for instantaneous detection
    // and resilience against dev environments or network proxies that don't upgrade WebSockets
    pollInterval = setInterval(checkStatus, 1000);
    initialPollTimeout = setTimeout(checkStatus, 400);

    try {
        const wsUrl = getWebSocketUrl(`/ws/auth/status?session=${encodeURIComponent(regSessionId)}`);
        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.status === 'VERIFIED') {
                    handleSuccess(data);
                } else if (data.status === 'EXPIRED' || data.status === 'FAILED') {
                    onMessage(data);
                    cleanup();
                } else {
                    onMessage(data);
                }
            } catch (parseErr) {
                void parseErr;
            }
        };

        ws.onerror = (event) => {
            if (onError) onError(event);
        };

        ws.onclose = () => {
            // WebSocket closed; background polling continues until verified or timed out
        };
    } catch (connErr) {
        void connErr;
    }

    return () => {
        if (initialPollTimeout) clearTimeout(initialPollTimeout);
        cleanup();
    };
}

export interface PairingWsEvent {
    type?: string;
    data?: string;
    status?: string;
    event?: string;
    code?: string;
    message?: string;
}

export function createPairingWebSocket(
    phone: string,
    token: string,
    onMessage: (msg: PairingWsEvent) => void,
    onError?: (err: unknown) => void
): () => void {
    let ws: WebSocket | null = null;
    let isClosed = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let initialPollTimeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
        isClosed = true;
        if (ws) {
            try {
                ws.close();
            } catch (closeErr) {
                void closeErr;
            }
            ws = null;
        }
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        if (initialPollTimeout) {
            clearTimeout(initialPollTimeout);
            initialPollTimeout = null;
        }
    };

    const handleSuccess = (status = 'ACTIVE') => {
        onMessage({ event: 'PAIRED', status });
        cleanup();
    };

    const checkStatus = async () => {
        if (isClosed) return;
        try {
            const clean = phone.replace(/\D/g, '');
            const check = await request<{ status?: string; paired?: boolean }>(
                `/api/v1/subbots/${encodeURIComponent(clean)}/status`
            );
            if (check && (check.status === 'ACTIVE' || check.paired === true)) {
                handleSuccess(check.status);
                return;
            }
        } catch {
            // Fallback: check subbots list
            try {
                const list = await listSubBots();
                const clean = phone.replace(/\D/g, '');
                const found = list.find((b: SubBotInstance) => b.id === clean && b.status === 'ACTIVE');
                if (found) {
                    handleSuccess('ACTIVE');
                }
            } catch {
                /* ignore */
            }
        }
    };

    // Fast polling starts alongside WebSocket for resilience in all environments
    pollInterval = setInterval(checkStatus, 1500);
    initialPollTimeout = setTimeout(checkStatus, 500);

    try {
        const wsUrl = getWebSocketUrl(
            `/ws/subbots/pair?phone=${encodeURIComponent(phone)}&token=${encodeURIComponent(token)}`
        );
        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.status === 'ACTIVE' || data.event === 'PAIRED' || data.paired === true) {
                    handleSuccess(data.status || 'ACTIVE');
                } else {
                    onMessage(data);
                }
            } catch (parseErr) {
                void parseErr;
                onMessage({ type: 'raw', data: event.data });
            }
        };

        ws.onerror = (event) => {
            if (onError) onError(event);
        };
    } catch (err) {
        if (onError) onError(err);
    }

    return () => {
        cleanup();
    };
}

// -------------------------------------------------------------
// System Telemetry & Health Endpoints
// -------------------------------------------------------------

/**
 * GET /api/v1/system/status
 * Fetches real-time operational metrics and health status.
 */
export async function getSystemStatus(): Promise<SystemStatusResponse> {
    return request<SystemStatusResponse>('/api/v1/system/status', {
        method: 'GET'
    });
}
