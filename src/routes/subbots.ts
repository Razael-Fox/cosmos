import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import { authenticateJwt } from '../middleware/authenticate.js';
import { deviceValidationPreHandler } from '../middleware/deviceValidation.js';
import { QuotaService, executeWithUserLock } from '../services/quotaService.js';
import { requestSubBotPairViaIpc } from '../services/ipcClient.js';

export const subbotRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /api/v1/subbots/list
    fastify.get('/list', { preHandler: [authenticateJwt, deviceValidationPreHandler] }, async (req, reply) => {
        const bots = await prisma.subBotInstance.findMany({
            where: { ownerJid: req.user.id },
            orderBy: { createdAt: 'desc' }
        });

        return reply.send(
            bots.map((b) => ({
                id: b.id,
                ownerJid: b.ownerJid,
                customPrefix: b.customPrefix,
                status: b.status,
                createdAt: b.createdAt.toISOString(),
                updatedAt: b.updatedAt.toISOString()
            }))
        );
    });

    // POST /api/v1/subbots/pair
    fastify.post('/pair', { preHandler: [authenticateJwt, deviceValidationPreHandler] }, async (req, reply) => {
        const body = req.body as { phone?: string; method?: 'code' | 'qr' };
        if (!body.phone || typeof body.phone !== 'string') {
            return reply.status(400).send({
                error: 'INVALID_PHONE',
                message: 'Sub-bot phone number is required.'
            });
        }

        const cleanPhone = body.phone.replace(/\D/g, '');
        if (cleanPhone.length < 8) {
            return reply.status(400).send({
                error: 'INVALID_PHONE',
                message: 'Sub-bot phone number is too short.'
            });
        }

        const userId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user?.isWhitelisted) {
            return reply.status(403).send({
                error: 'UNAUTHORIZED_NOT_WHITELISTED',
                message: 'Account must be whitelisted before pairing a sub-bot.'
            });
        }

        return executeWithUserLock(userId, async () => {
            const canPair = await QuotaService.canPairSubBot(userId);
            if (!canPair.allowed) {
                return reply.status(403).send({
                    error: 'QUOTA_EXCEEDED',
                    message: canPair.reason || 'Maximum sub-bot instance quota reached.'
                });
            }

            // Check for cross-user hijack
            const existing = await prisma.subBotInstance.findUnique({
                where: { id: cleanPhone }
            });

            if (existing && existing.ownerJid !== userId) {
                return reply.status(403).send({
                    error: 'SUBBOT_OWNED_BY_ANOTHER',
                    message: 'This sub-bot phone number is claimed by another user.'
                });
            }

            const method = body.method === 'qr' ? 'qr' : 'code';
            const expiresIn = 120; // 2 minutes pairing expiry

            // Request a genuine Baileys pairing credential from the bot engine.
            let ipcRes;
            try {
                ipcRes = await requestSubBotPairViaIpc(cleanPhone, method, userId);
            } catch (err) {
                console.error('[SubBot] IPC pairing request failed:', err);
                return reply.status(503).send({
                    error: 'BOT_OFFLINE',
                    message: 'Bot engine is unreachable. Please try again shortly.'
                });
            }

            if (ipcRes.status === 503 || ipcRes.status === 504 || ipcRes.status === 502) {
                return reply.status(503).send({
                    error: 'BOT_OFFLINE',
                    message: 'Bot engine is unreachable. Please try again shortly.'
                });
            }

            if (ipcRes.status !== 200) {
                const botError = (ipcRes.data as { error?: string } | undefined)?.error || 'PAIRING_FAILED';
                return reply.status(ipcRes.status === 401 ? 500 : ipcRes.status).send({
                    error: botError,
                    message: 'Sub-bot pairing could not be started.'
                });
            }

            const pairData = ipcRes.data as { pairingCode?: string; qrCode?: string };
            const credential = method === 'code' ? pairData.pairingCode : pairData.qrCode;
            if (!credential) {
                return reply.status(500).send({
                    error: 'PAIRING_FAILED',
                    message:
                        method === 'code'
                            ? 'Bot engine did not return a pairing code.'
                            : 'Bot engine did not return a QR payload.'
                });
            }

            // Record pairing attempt (bot flips to ACTIVE on link)
            await prisma.subBotInstance.upsert({
                where: { id: cleanPhone },
                update: {
                    ownerJid: userId,
                    status: 'PAIRING'
                },
                create: {
                    id: cleanPhone,
                    ownerJid: userId,
                    customPrefix: '.',
                    status: 'PAIRING'
                }
            });

            if (method === 'code') {
                return reply.send({
                    pairingCode: credential,
                    expiresIn
                });
            } else {
                return reply.send({
                    qrCode: credential,
                    expiresIn: 60
                });
            }
        });
    });

    // DELETE /api/v1/subbots/:phone
    fastify.delete('/:phone', { preHandler: [authenticateJwt, deviceValidationPreHandler] }, async (req, reply) => {
        const params = req.params as { phone?: string };
        if (!params.phone) {
            return reply.status(400).send({
                error: 'INVALID_PHONE',
                message: 'Sub-bot phone number is required.'
            });
        }

        const cleanPhone = decodeURIComponent(params.phone).replace(/\D/g, '');
        const userId = req.user.id;

        const existing = await prisma.subBotInstance.findUnique({
            where: { id: cleanPhone }
        });

        if (!existing) {
            return reply.status(404).send({
                error: 'NOT_FOUND',
                message: 'Sub-bot instance was not found.'
            });
        }

        // Strict IDOR ownership check
        if (existing.ownerJid !== userId) {
            return reply.status(403).send({
                error: 'FORBIDDEN',
                message: 'You do not have permission to delete this sub-bot.'
            });
        }

        await prisma.subBotInstance.delete({
            where: { id: cleanPhone }
        });

        return reply.send({ success: true });
    });
};
