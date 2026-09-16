import fs from 'fs';
import net from 'net';
import path from 'path';
import { prisma } from '#db.js';
import { timingSafeStringCompare } from './otpService.js';
import { dispatchLoginSecurityAlert } from './securityAlertService.js';
import { activeConnections } from '#utils/connectionManager.js';

export const DEFAULT_IPC_SOCKET = '/app/storage/ipc.sock';

export function getIpcSocketPath(): string {
    return process.env.BOT_IPC_SOCKET || process.env.IPC_SOCKET_PATH || DEFAULT_IPC_SOCKET;
}

function getIpcSecret(): string {
    return process.env.INTERNAL_IPC_SECRET || '';
}

export interface IpcRequest {
    path: string;
    secret?: string;
    body?: Record<string, unknown>;
}

function sendJson(socket: net.Socket, status: number, payload: unknown): void {
    socket.write(`${JSON.stringify({ status, data: payload })}\n`);
}

async function handleCommand(req: IpcRequest): Promise<{ status: number; data: unknown }> {
    const secret = getIpcSecret();
    const provided = typeof req.secret === 'string' ? req.secret : '';
    if (!secret || !timingSafeStringCompare(provided, secret)) {
        return { status: 401, data: { error: 'UNAUTHORIZED_IPC' } };
    }

    const body = req.body ?? {};

    switch (req.path) {
        case '/internal/auth/send-otp': {
            const targetJid = String(body.targetJid || '');
            const code = String(body.code || '');
            if (!targetJid || !code) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };
            const sock = activeConnections.get('default');
            if (!sock) return { status: 503, data: { error: 'BOT_OFFLINE' } };
            await sock.sendMessage(targetJid, {
                text: `🔐 *Cosmos Verification Code*\n\nYour one-time code is: *${code}*\nIt expires in 5 minutes. Do not share this code with anyone.`
            });
            console.log(`[IPC] OTP dispatched to ${targetJid}`);
            return { status: 200, data: { ok: true } };
        }
        case '/internal/auth/verified': {
            const canonicalJid = String(body.canonicalJid || '');
            if (!canonicalJid) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };
            const sock = activeConnections.get('default');
            if (sock) {
                await sock
                    .sendMessage(canonicalJid, {
                        text: `✅ *Registration Verified!*\n\nYour account has been whitelisted successfully. You may now proceed on the web dashboard.`
                    })
                    .catch((err) => console.error('[IPC] Verification notice failed:', err));
            }
            console.log(`[IPC] Registration verified for ${canonicalJid}`);
            return { status: 200, data: { ok: true } };
        }
        case '/internal/security/notify-login': {
            const userJid = String(body.userJid || '');
            const ipAddress = String(body.ipAddress || 'unknown');
            if (!userJid) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };
            await dispatchLoginSecurityAlert({
                userJid,
                ipAddress,
                country: (body.country as string) ?? null,
                userAgent: (body.userAgent as string) ?? null,
                deviceType: (body.deviceType as string) ?? null,
                isNewDevice: Boolean(body.isNewDevice ?? true)
            });
            try {
                await prisma.userIpAccessLog.create({
                    data: {
                        userId: userJid,
                        ipAddress,
                        country: (body.country as string) ?? null,
                        userAgent: (body.userAgent as string) ?? null,
                        action: 'LOGIN',
                        status: body.isNewDevice ? 'NEW_DEVICE_DETECTED' : 'ALLOWED',
                        details: JSON.stringify({ source: 'ipc', deviceType: body.deviceType ?? null })
                    }
                });
            } catch (err) {
                console.error('[IPC] Failed to persist login audit log:', err);
            }
            return { status: 200, data: { ok: true } };
        }
        case '/internal/subscriptions/activated': {
            const userJid = String(body.userJid || '');
            const tier = String(body.tier || 'FREE');
            if (!userJid) return { status: 400, data: { error: 'INVALID_PAYLOAD' } };
            const sock = activeConnections.get('default');
            if (sock) {
                await sock
                    .sendMessage(userJid, {
                        text:
                            `🎉 *Subscription Activated!*\n\n` +
                            `Tier: ${tier}\n` +
                            `Valid Until: ${(body.expiresAt as string) || 'Unlimited'}\n\n` +
                            `Thank you for supporting Cosmos!`
                    })
                    .catch((err) => console.error('[IPC] Subscription receipt failed:', err));
            }
            return { status: 200, data: { ok: true } };
        }
        case '/internal/health': {
            return { status: 200, data: { ok: true, connections: activeConnections.size } };
        }
        default:
            return { status: 404, data: { error: 'UNKNOWN_IPC_PATH' } };
    }
}

let server: net.Server | null = null;

export function startIpcServer(socketPath: string = getIpcSocketPath()): net.Server {
    if (server) return server;
    const dir = path.dirname(socketPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
        if (fs.existsSync(socketPath)) fs.rmSync(socketPath, { force: true });
    } catch {
        /* ignore stale socket cleanup errors */
    }

    server = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            const idx = buffer.indexOf('\n');
            if (idx === -1) return;
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            (async () => {
                try {
                    const req = JSON.parse(line) as IpcRequest;
                    const result = await handleCommand(req);
                    sendJson(socket, result.status, result.data);
                } catch (err) {
                    console.error('[IPC] Failed to handle command:', err);
                    sendJson(socket, 400, { error: 'MALFORMED_IPC_REQUEST' });
                } finally {
                    socket.end();
                }
            })();
        });
    });

    server.listen(socketPath, () => {
        try {
            fs.chmodSync(socketPath, 0o600);
        } catch (err) {
            console.error('[IPC] Failed to chmod IPC socket:', err);
        }
        console.log(`[IPC] Bot IPC server listening on ${socketPath} (chmod 600)`);
    });
    server.on('error', (err) => console.error('[IPC] Server error:', err));
    return server;
}

/** Client helper used by co-located processes and tests to send authenticated IPC commands. */
export function sendIpcCommand(
    targetPath: string,
    body: Record<string, unknown>,
    socketPath: string = getIpcSocketPath()
): Promise<{ status: number; data: unknown }> {
    const secret = getIpcSecret();
    return new Promise((resolve, reject) => {
        const client = net.createConnection(socketPath, () => {
            client.write(`${JSON.stringify({ path: targetPath, secret, body })}\n`);
        });
        let buffer = '';
        client.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
        });
        client.on('end', () => {
            try {
                resolve(JSON.parse(buffer.trim()) as { status: number; data: unknown });
            } catch (err) {
                reject(err);
            }
        });
        client.on('error', reject);
    });
}
