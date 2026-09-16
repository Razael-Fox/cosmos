import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import { subscribeAuthStatus } from '../services/authEventBus.js';
import { processDeviceValidation } from '../middleware/deviceValidation.js';

export const wsRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /ws/auth/status?session=<regSessionId>
    fastify.get('/auth/status', { websocket: true }, (socket, req) => {
        const query = req.query as { session?: string };
        const sessionId = query.session?.trim();

        if (!sessionId) {
            socket.send(JSON.stringify({ status: 'FAILED', error: 'MISSING_SESSION_ID' }));
            socket.close();
            return;
        }

        let isClosed = false;

        const cleanup = () => {
            if (isClosed) return;
            isClosed = true;
            if (pollTimer) clearInterval(pollTimer);
            unsubscribe();
            try {
                socket.close();
            } catch {
                /* ignore */
            }
        };

        // EventBus listener
        const unsubscribe = subscribeAuthStatus(sessionId, (event) => {
            if (isClosed) return;
            try {
                socket.send(JSON.stringify(event));
                if (event.status === 'VERIFIED' || event.status === 'EXPIRED' || event.status === 'FAILED') {
                    cleanup();
                }
            } catch {
                cleanup();
            }
        });

        // Periodic database polling for cross-process SQLite synchronization with bot engine
        const pollTimer = setInterval(async () => {
            if (isClosed) return;
            try {
                const record = await prisma.otpVerification.findUnique({
                    where: { regSessionId: sessionId }
                });

                if (!record) {
                    socket.send(JSON.stringify({ status: 'FAILED', error: 'NOT_FOUND' }));
                    cleanup();
                    return;
                }

                if (record.isUsed) {
                    const canonicalJid = record.userJid || `${record.phoneNumber}@s.whatsapp.net`;
                    const user = await prisma.user.findUnique({ where: { id: canonicalJid } });
                    if (user && user.isWhitelisted) {
                        await processDeviceValidation(user.id, req, 'WS_VERIFIED', true);
                        const jwtToken = fastify.jwt.sign({ id: user.id, phoneNumber: record.phoneNumber });
                        socket.send(JSON.stringify({ status: 'VERIFIED', jwtToken }));
                        cleanup();
                        return;
                    }
                }

                if (record.attempts >= record.maxAttempts) {
                    socket.send(JSON.stringify({ status: 'FAILED', error: 'LOCKED' }));
                    cleanup();
                    return;
                }

                if (record.expiresAt.getTime() < Date.now()) {
                    socket.send(JSON.stringify({ status: 'EXPIRED' }));
                    cleanup();
                    return;
                }
            } catch (err) {
                console.error('[WS Auth] Polling error:', err);
            }
        }, 500);

        socket.on('close', cleanup);
        socket.on('error', cleanup);
    });

    // GET /ws/subbots/pair?phone=<phone>&token=<jwtToken>
    fastify.get('/subbots/pair', { websocket: true }, async (socket, req) => {
        const query = req.query as { phone?: string; token?: string };
        const token = query.token?.trim();
        const phone = query.phone?.replace(/\D/g, '');

        if (!token || !phone) {
            socket.send(JSON.stringify({ event: 'error', message: 'Missing token or phone parameters.' }));
            socket.close();
            return;
        }

        // Token authentication check
        let userJid: string;
        try {
            const decoded = fastify.jwt.verify<{ id: string }>(token);
            userJid = decoded.id;
        } catch {
            socket.send(JSON.stringify({ event: 'error', message: 'Unauthorized: Invalid token.' }));
            socket.close();
            return;
        }

        const user = await prisma.user.findUnique({ where: { id: userJid } });
        if (!user?.isWhitelisted) {
            socket.send(JSON.stringify({ event: 'error', message: 'Forbidden: Account not whitelisted.' }));
            socket.close();
            return;
        }

        socket.send(
            JSON.stringify({
                event: 'status',
                status: 'CONNECTED',
                message: `Pairing session initiated for +${phone}. Waiting for authentication.`
            })
        );

        const keepAlive = setInterval(() => {
            try {
                socket.send(JSON.stringify({ event: 'ping', timestamp: Date.now() }));
            } catch {
                clearInterval(keepAlive);
            }
        }, 15000);

        socket.on('close', () => clearInterval(keepAlive));
        socket.on('error', () => clearInterval(keepAlive));
    });
};
