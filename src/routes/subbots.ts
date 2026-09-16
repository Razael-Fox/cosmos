import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../db.js';
import { authenticateJwt } from '../middleware/authenticate.js';
import { deviceValidationPreHandler } from '../middleware/deviceValidation.js';
import { QuotaService, executeWithUserLock } from '../services/quotaService.js';

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

            // Record or update subbot instance
            await prisma.subBotInstance.upsert({
                where: { id: cleanPhone },
                update: {
                    ownerJid: userId,
                    status: 'ACTIVE'
                },
                create: {
                    id: cleanPhone,
                    ownerJid: userId,
                    customPrefix: '.',
                    status: 'ACTIVE'
                }
            });

            const method = body.method === 'qr' ? 'qr' : 'code';
            const expiresIn = 120; // 2 minutes pairing expiry

            if (method === 'code') {
                // Generate 8-character pairing code format: XXXX-XXXX
                const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
                const pairingCode = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
                return reply.send({
                    pairingCode,
                    expiresIn
                });
            } else {
                const rawQr = `2@${crypto.randomBytes(24).toString('base64')},${crypto.randomBytes(32).toString('base64')},${crypto.randomBytes(32).toString('base64')}`;
                return reply.send({
                    qrCode: rawQr,
                    expiresIn
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
