import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import { authenticateJwt } from '../middleware/authenticate.js';
import { deviceValidationPreHandler } from '../middleware/deviceValidation.js';
import { QuotaService, executeWithUserLock } from '../services/quotaService.js';

export const groupRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /api/v1/groups
    fastify.get('/', { preHandler: [authenticateJwt, deviceValidationPreHandler] }, async (req, reply) => {
        const groups = await prisma.whitelistedGroup.findMany({
            where: { ownerJid: req.user.id },
            orderBy: { createdAt: 'desc' }
        });

        return reply.send(
            groups.map((g) => ({
                jid: g.jid,
                language: g.language,
                ownerJid: g.ownerJid,
                createdAt: g.createdAt.toISOString()
            }))
        );
    });

    // POST /api/v1/groups/whitelist
    fastify.post('/whitelist', { preHandler: [authenticateJwt, deviceValidationPreHandler] }, async (req, reply) => {
        const body = req.body as { jid?: string; language?: string };
        if (!body.jid || typeof body.jid !== 'string') {
            return reply.status(400).send({
                error: 'INVALID_JID',
                message: 'Group JID is required (e.g. 123456789-987654@g.us).'
            });
        }

        const cleanJid = body.jid.trim();
        const userId = req.user.id;

        return executeWithUserLock(userId, async () => {
            const canAdd = await QuotaService.canAddGroup(userId);
            if (!canAdd.allowed) {
                return reply.status(403).send({
                    error: 'QUOTA_EXCEEDED',
                    message: canAdd.reason || 'Maximum whitelisted group quota reached.'
                });
            }

            // Check ownership to prevent hijack
            const existing = await prisma.whitelistedGroup.findUnique({
                where: { jid: cleanJid }
            });

            if (existing) {
                if (existing.ownerJid && existing.ownerJid !== userId) {
                    return reply.status(403).send({
                        error: 'GROUP_OWNED_BY_ANOTHER',
                        message: 'This group is already registered and claimed by another user.'
                    });
                }

                // If existing group has no owner, associate it
                const updated = await prisma.whitelistedGroup.update({
                    where: { jid: cleanJid },
                    data: {
                        ownerJid: userId,
                        language: body.language === 'EN' ? 'EN' : 'ID'
                    }
                });

                return reply.send({
                    jid: updated.jid,
                    language: updated.language,
                    ownerJid: updated.ownerJid,
                    createdAt: updated.createdAt.toISOString()
                });
            }

            const created = await prisma.whitelistedGroup.create({
                data: {
                    jid: cleanJid,
                    language: body.language === 'EN' ? 'EN' : 'ID',
                    ownerJid: userId
                }
            });

            return reply.send({
                jid: created.jid,
                language: created.language,
                ownerJid: created.ownerJid,
                createdAt: created.createdAt.toISOString()
            });
        });
    });

    // DELETE /api/v1/groups/:jid
    fastify.delete('/:jid', { preHandler: [authenticateJwt, deviceValidationPreHandler] }, async (req, reply) => {
        const params = req.params as { jid?: string };
        if (!params.jid) {
            return reply.status(400).send({ error: 'INVALID_JID', message: 'Group JID is required.' });
        }

        const jid = decodeURIComponent(params.jid.trim());
        const userId = req.user.id;

        const existing = await prisma.whitelistedGroup.findUnique({
            where: { jid }
        });

        if (!existing) {
            return reply.status(404).send({
                error: 'NOT_FOUND',
                message: 'Whitelisted group was not found.'
            });
        }

        // Strict IDOR ownership check
        if (existing.ownerJid !== userId) {
            return reply.status(403).send({
                error: 'FORBIDDEN',
                message: 'You do not have permission to delete this group.'
            });
        }

        await prisma.whitelistedGroup.delete({
            where: { jid }
        });

        return reply.send({ success: true });
    });
};
