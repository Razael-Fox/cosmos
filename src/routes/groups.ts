import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import { authenticateJwt } from '../middleware/authenticate.js';
import { deviceValidationPreHandler } from '../middleware/deviceValidation.js';
import { QuotaService, executeWithUserLock } from '../services/quotaService.js';
import { fetchParticipatingGroupsViaIpc, type ParticipatingGroupIpcItem } from '../services/ipcClient.js';

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

    // GET /api/v1/groups/participating
    fastify.get('/participating', { preHandler: [authenticateJwt, deviceValidationPreHandler] }, async (req, reply) => {
        const userId = req.user.id;

        let botGroups: ParticipatingGroupIpcItem[] = [];
        try {
            const ipcRes = await fetchParticipatingGroupsViaIpc(userId);
            if (ipcRes.status === 200 && Array.isArray(ipcRes.data?.groups)) {
                botGroups = ipcRes.data.groups;
            }
        } catch (err) {
            console.warn('[Groups] Failed to fetch participating groups via IPC:', err);
        }

        const whitelisted = await prisma.whitelistedGroup.findMany({
            where: { ownerJid: userId }
        });
        const whitelistedSet = new Set(whitelisted.map((g) => g.jid));

        const quota = await QuotaService.getUserQuota(userId);

        const groups = botGroups.map((g) => ({
            id: g.id,
            subject: g.subject,
            size: g.size,
            desc: g.desc,
            isAdmin: Boolean(g.isAdmin),
            isWhitelisted: whitelistedSet.has(g.id),
            pictureUrl: g.pictureUrl || null
        }));

        // Guarantee all whitelisted groups owned by user remain visible regardless of bot cache or admin status
        for (const wg of whitelisted) {
            if (!groups.some((g) => g.id === wg.jid)) {
                groups.push({
                    id: wg.jid,
                    subject: 'WhatsApp Group',
                    size: 0,
                    desc: undefined,
                    isAdmin: false,
                    isWhitelisted: true,
                    pictureUrl: null
                });
            }
        }

        return reply.send({
            groups,
            quota: {
                current: quota.groups.current,
                max: quota.groups.max,
                available: quota.groups.available,
                tier: quota.tier,
                isLimitReached: quota.groups.current >= quota.groups.max
            }
        });
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
