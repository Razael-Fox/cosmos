import net from 'net';
import { config } from '../config.js';

export interface IpcResponse<T = unknown> {
    status: number;
    data: T;
}

export function sendIpcCommand<T = unknown>(
    targetPath: string,
    body: Record<string, unknown> = {},
    socketPath: string = config.BOT_IPC_SOCKET,
    timeoutMs: number = 4000
): Promise<IpcResponse<T>> {
    const secret = config.INTERNAL_IPC_SECRET;

    return new Promise((resolve) => {
        let finished = false;
        const client = net.createConnection(socketPath);

        const timeout = setTimeout(() => {
            if (!finished) {
                finished = true;
                client.destroy();
                resolve({ status: 504, data: { error: 'IPC_TIMEOUT' } as T });
            }
        }, timeoutMs);

        client.on('connect', () => {
            client.write(`${JSON.stringify({ path: targetPath, secret, body })}\n`);
        });

        let buffer = '';
        client.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            if (buffer.includes('\n')) {
                finished = true;
                clearTimeout(timeout);
                client.end();
                try {
                    const parsed = JSON.parse(buffer.trim()) as IpcResponse<T>;
                    resolve(parsed);
                } catch {
                    resolve({ status: 500, data: { error: 'MALFORMED_IPC_RESPONSE' } as T });
                }
            }
        });

        client.on('error', (err) => {
            if (!finished) {
                finished = true;
                clearTimeout(timeout);
                console.warn(`[IPC Client] Socket connection error (${targetPath}):`, err.message);
                resolve({ status: 503, data: { error: 'BOT_OFFLINE', details: err.message } as T });
            }
        });

        client.on('end', () => {
            if (!finished) {
                finished = true;
                clearTimeout(timeout);
                if (!buffer.trim()) {
                    resolve({ status: 502, data: { error: 'EMPTY_IPC_RESPONSE' } as T });
                    return;
                }
                try {
                    const parsed = JSON.parse(buffer.trim()) as IpcResponse<T>;
                    resolve(parsed);
                } catch {
                    resolve({ status: 500, data: { error: 'MALFORMED_IPC_RESPONSE' } as T });
                }
            }
        });
    });
}

export async function sendOtpViaIpc(targetJid: string, code: string): Promise<IpcResponse> {
    return sendIpcCommand('/internal/auth/send-otp', { targetJid, code });
}

export async function notifyLoginViaIpc(data: {
    userJid: string;
    ipAddress: string;
    country?: string | null;
    userAgent?: string | null;
    deviceType?: string | null;
    isNewDevice: boolean;
}): Promise<IpcResponse> {
    return sendIpcCommand('/internal/security/notify-login', data);
}

export async function notifySubscriptionActivatedViaIpc(
    userJid: string,
    tier: string,
    expiresAt?: string | null
): Promise<IpcResponse> {
    return sendIpcCommand('/internal/subscriptions/activated', { userJid, tier, expiresAt });
}

export async function checkBotHealthViaIpc(): Promise<IpcResponse<{ ok: boolean; connections?: number }>> {
    return sendIpcCommand<{ ok: boolean; connections?: number }>('/internal/health');
}

export interface SubBotPairIpcData {
    pairingCode?: string;
    qrCode?: string;
    error?: string;
}

/**
 * Requests a genuine Baileys pairing credential from the bot engine.
 * Real code issuance requires socket connect plus version fetch, so this
 * allows up to 90 seconds for the bot to respond.
 */
export async function requestSubBotPairViaIpc(
    phone: string,
    method: 'code' | 'qr',
    requesterJid: string
): Promise<IpcResponse<SubBotPairIpcData>> {
    return sendIpcCommand<SubBotPairIpcData>(
        '/internal/subbots/pair',
        { phone, method, requesterJid },
        config.BOT_IPC_SOCKET,
        90000
    );
}

export interface SubBotStatusIpcData {
    state?: 'ACTIVE' | 'PAIRING' | 'IDLE';
    error?: string;
}

export async function getSubBotPairingStateViaIpc(phone: string): Promise<IpcResponse<SubBotStatusIpcData>> {
    return sendIpcCommand<SubBotStatusIpcData>('/internal/subbots/status', { phone }, config.BOT_IPC_SOCKET, 8000);
}
