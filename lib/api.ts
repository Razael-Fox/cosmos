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
} from './types';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');
const TOKEN_STORAGE_KEY = 'cosmos_jwt_token';

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
}

/**
 * Clears the stored JWT authentication token from localStorage.
 */
export function clearStoredToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

/**
 * Low-level typed HTTP client for Cosmos API endpoints.
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const response = await fetch(url, {
    ...options,
    headers,
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
export async function registerInverted(
  payload: RegisterInvertedRequest
): Promise<RegisterInvertedResponse> {
  return request<RegisterInvertedResponse>('/api/v1/auth/register-inverted', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * POST /api/v1/auth/register-direct
 * Direct OTP dispatch gated strictly by Cloudflare Turnstile token validation.
 */
export async function registerDirect(
  payload: RegisterDirectRequest
): Promise<RegisterDirectResponse> {
  return request<RegisterDirectResponse>('/api/v1/auth/register-direct', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * POST /api/v1/auth/verify-otp
 * Verifies submitted 6-digit OTP and returns authenticated JWT token.
 */
export async function verifyOtp(
  payload: VerifyOtpRequest
): Promise<VerifyOtpResponse> {
  const res = await request<VerifyOtpResponse>('/api/v1/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (res.jwtToken) {
    setStoredToken(res.jwtToken);
  }
  return res;
}

/**
 * POST /api/v1/auth/resend-otp
 * Requests a new OTP with Turnstile challenge.
 */
export async function resendOtp(
  payload: ResendOtpRequest
): Promise<ResendOtpResponse> {
  return request<ResendOtpResponse>('/api/v1/auth/resend-otp', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * POST /api/v1/auth/login
 * Standard password login for already whitelisted accounts.
 */
export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const res = await request<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (res.jwtToken) {
    setStoredToken(res.jwtToken);
  }
  return res;
}

// -------------------------------------------------------------
// Subscriptions & Pricing Endpoints
// -------------------------------------------------------------

/**
 * GET /api/v1/subscriptions/sales-link
 * Generates dynamic sales representative WhatsApp link with prefilled plan and order ref.
 */
export async function getSalesLink(
  tier: SubscriptionTier,
  phone?: string
): Promise<SalesLinkResponse> {
  const params = new URLSearchParams({ tier });
  if (phone) params.set('phone', phone);
  return request<SalesLinkResponse>(`/api/v1/subscriptions/sales-link?${params.toString()}`, {
    method: 'GET',
  });
}

/**
 * GET /api/v1/subscriptions/status
 * Fetches current tier, expiration, and quota usage for authenticated user.
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatusResponse> {
  return request<SubscriptionStatusResponse>('/api/v1/subscriptions/status', {
    method: 'GET',
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
    method: 'GET',
  });
}

/**
 * POST /api/v1/groups/whitelist
 * Adds a new whitelisted group, gated strictly by QuotaService.
 */
export async function addGroup(payload: AddGroupRequest): Promise<WhitelistedGroup> {
  return request<WhitelistedGroup>('/api/v1/groups/whitelist', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * DELETE /api/v1/groups/:jid
 * Removes whitelisted group with strict IDOR tenant isolation.
 */
export async function deleteGroup(jid: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/groups/${encodeURIComponent(jid)}`, {
    method: 'DELETE',
  });
}

// -------------------------------------------------------------
// Sub-Bot Lifecycle & Pairing Endpoints
// -------------------------------------------------------------

/**
 * POST /api/v1/subbots/pair
 * Initiates pairing session with code or QR method.
 */
export async function pairSubBot(
  payload: PairSubBotRequest
): Promise<PairSubBotResponse> {
  return request<PairSubBotResponse>('/api/v1/subbots/pair', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * GET /api/v1/subbots/list
 * Returns active and registered sub-bots owned by authenticated user.
 */
export async function listSubBots(): Promise<SubBotInstance[]> {
  return request<SubBotInstance[]>('/api/v1/subbots/list', {
    method: 'GET',
  });
}

/**
 * DELETE /api/v1/subbots/:phone
 * Disconnects and removes sub-bot instance.
 */
export async function deleteSubBot(phone: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/v1/subbots/${encodeURIComponent(phone)}`, {
    method: 'DELETE',
  });
}

// -------------------------------------------------------------
// Real-Time WebSockets
// -------------------------------------------------------------

function getWebSocketUrl(pathWithQuery: string): string {
  const origin = API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  const wsProtocol = origin.startsWith('https') ? 'wss:' : 'ws:';
  const cleanHost = origin.replace(/^https?:\/\//, '');
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

  const startPollingFallback = () => {
    if (pollInterval || isClosed) return;
    pollInterval = setInterval(async () => {
      if (isClosed) return;
      try {
        const check = await request<AuthStatusWsMessage>(
          `/api/v1/auth/status?session=${encodeURIComponent(regSessionId)}`
        );
        if (check && check.status === 'VERIFIED') {
          if (check.jwtToken) setStoredToken(check.jwtToken);
          onMessage(check);
          cleanup();
        }
      } catch (pollErr) {
        void pollErr;
      }
    }, 2500);
  };

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
  };

  try {
    const wsUrl = getWebSocketUrl(`/ws/auth/status?session=${encodeURIComponent(regSessionId)}`);
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status === 'VERIFIED' && data.jwtToken) {
          setStoredToken(data.jwtToken);
        }
        onMessage(data);
      } catch (parseErr) {
        void parseErr;
      }
    };

    ws.onerror = (event) => {
      if (onError) onError(event);
      startPollingFallback();
    };

    ws.onclose = () => {
      if (!isClosed) startPollingFallback();
    };
  } catch (connErr) {
    void connErr;
    startPollingFallback();
  }

  return cleanup;
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

  try {
    const wsUrl = getWebSocketUrl(
      `/ws/subbots/pair?phone=${encodeURIComponent(phone)}&token=${encodeURIComponent(token)}`
    );
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
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
    if (ws) {
      try {
        ws.close();
      } catch (closeErr) {
        void closeErr;
      }
      ws = null;
    }
  };
}
