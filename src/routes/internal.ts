import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { timingSafeStringCompare } from '../services/cryptoService.js';
import { emitAuthStatus } from '../services/authEventBus.js';
import { processDeviceValidation } from '../middleware/deviceValidation.js';
import { serializeUser } from '../utils/userSerializer.js';

export const internalRoutes: FastifyPluginAsync = async (fastify) => {
    // POST /internal/auth/verified
    fastify.post('/auth/verified', async (req, reply) => {
        const secretHeader = req.headers['x-internal-secret'] as string | undefined;
        const bodySecret = (req.body as { secret?: string } | undefined)?.secret;
        const authHeader = req.headers['authorization'];
        const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

        const providedSecret = secretHeader || bodySecret || bearer || '';
        const expectedSecret = config.INTERNAL_IPC_SECRET;

        if (!expectedSecret || !timingSafeStringCompare(providedSecret, expectedSecret)) {
            return reply.status(401).send({ error: 'UNAUTHORIZED_INTERNAL' });
        }

        const body = req.body as {
            phoneNumber?: string;
            canonicalJid?: string;
            regSessionId?: string;
            pushName?: string;
            username?: string;
        };

        if (!body.canonicalJid) {
            return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'canonicalJid is required.' });
        }

        const canonicalJid = body.canonicalJid;
        const phoneNumber = body.phoneNumber || canonicalJid.replace(/\D/g, '');
        const regSessionId = body.regSessionId;

        // Upsert user to ensure whitelisted and save WhatsApp username / profile name
        const user = await prisma.user.upsert({
            where: { id: canonicalJid },
            update: {
                isWhitelisted: true,
                ...(body.pushName ? { pushName: body.pushName } : {}),
                ...(body.username ? { username: body.username } : {})
            },
            create: {
                id: canonicalJid,
                pushName: body.pushName || null,
                username: body.username || null,
                isWhitelisted: true
            }
        });

        // Register UserDevice isTrusted=true
        await processDeviceValidation(canonicalJid, req, 'BOT_VERIFIED', true);

        // Issue JWT
        const jwtToken = fastify.jwt.sign({ id: canonicalJid, phoneNumber });
        const serialized = serializeUser(user);

        // If regSessionId is provided, emit real-time event to active WebSocket
        if (regSessionId) {
            emitAuthStatus(regSessionId, { status: 'VERIFIED', jwtToken, user: serialized });
        }

        return reply.send({ ok: true, jwtToken, user: serialized });
    });
};
