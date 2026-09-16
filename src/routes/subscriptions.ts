import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { authenticateJwt } from '../middleware/authenticate.js';
import { deviceValidationPreHandler } from '../middleware/deviceValidation.js';
import { verifyAdminKey } from '../services/cryptoService.js';
import { QuotaService, executeWithUserLock, type SubscriptionTierName } from '../services/quotaService.js';
import { buildSalesLink, normalizeTier, activateSubscription } from '../services/subscriptionService.js';
import { notifySubscriptionActivatedViaIpc } from '../services/ipcClient.js';

export async function handleAdminActivate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = req.headers['authorization'];
    if (!verifyAdminKey(authHeader)) {
        reply.status(401).send({
            error: 'UNAUTHORIZED_ADMIN',
            message: 'Invalid or missing administrator authorization key.'
        });
        return;
    }

    const body = req.body as {
        phone?: string;
        tier?: string;
        durationDays?: number;
        notes?: string;
    };

    if (!body.phone || !body.tier || typeof body.durationDays !== 'number') {
        reply.status(400).send({
            error: 'INVALID_PAYLOAD',
            message: 'Phone number, tier name, and durationDays are required.'
        });
        return;
    }

    const cleanPhone = body.phone.replace(/\D/g, '');
    const canonicalJid = `${cleanPhone}@s.whatsapp.net`;
    const tier = normalizeTier(body.tier);
    if (!tier) {
        reply.status(400).send({
            error: 'INVALID_TIER',
            message: 'Invalid tier specified. Allowed tiers: FREE, SUBSIDIZED, PARTNER.'
        });
        return;
    }

    // Ensure user exists before assigning subscription
    await prisma.user.upsert({
        where: { id: canonicalJid },
        update: { isWhitelisted: true },
        create: { id: canonicalJid, isWhitelisted: true }
    });

    const result = await executeWithUserLock(canonicalJid, async () => {
        return activateSubscription(
            canonicalJid,
            tier as SubscriptionTierName,
            body.durationDays!,
            'ADMIN_API',
            body.notes
        );
    });

    // Notify bot via IPC
    await notifySubscriptionActivatedViaIpc(
        canonicalJid,
        tier,
        result.expiresAt ? result.expiresAt.toISOString() : 'Unlimited'
    ).catch((err) => {
        console.warn('[Subscriptions] Failed to notify bot via IPC:', err);
    });

    reply.send({
        success: true,
        expiresAt: result.expiresAt ? result.expiresAt.toISOString() : null,
        orderRef: result.orderRef
    });
}

export const subscriptionRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /api/v1/subscriptions/sales-link
    fastify.get('/sales-link', async (req, reply) => {
        const query = req.query as { tier?: string; phone?: string };
        const tier = normalizeTier(query.tier || 'SUBSIDIZED');
        if (!tier) {
            return reply.status(400).send({
                error: 'INVALID_TIER',
                message: 'Supported subscription tiers are FREE, SUBSIDIZED, or PARTNER.'
            });
        }

        const phone = (query.phone || 'unknown').replace(/\D/g, '');
        const sales = buildSalesLink(config.SALES_PHONE_NUMBER, tier, phone || 'Customer');

        return reply.send({
            salesUrl: sales.salesUrl,
            orderRef: sales.orderRef
        });
    });

    // GET /api/v1/subscriptions/status
    fastify.get('/status', { preHandler: [authenticateJwt, deviceValidationPreHandler] }, async (req, reply) => {
        const userId = req.user.id;
        const quota = await QuotaService.getUserQuota(userId);

        const sub = await prisma.subscription.findUnique({
            where: { userId }
        });

        return reply.send({
            tier: quota.tier,
            status: (sub?.status as string) || 'ACTIVE',
            maxSubBots: quota.subBots.max,
            maxGroups: quota.groups.max,
            customPrefix: quota.customPrefixAllowed,
            startedAt: sub ? sub.startedAt.toISOString() : new Date().toISOString(),
            expiresAt: quota.expiresAt ? quota.expiresAt.toISOString() : null,
            currentSubBots: quota.subBots.current,
            currentGroups: quota.groups.current
        });
    });

    // POST /api/v1/subscriptions/activate
    fastify.post('/activate', handleAdminActivate);
};

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
    // POST /api/v1/admin/subscriptions/activate
    fastify.post('/subscriptions/activate', handleAdminActivate);
};
