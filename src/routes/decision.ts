import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DecisionService } from '../services/decisionService.js';
import { authenticateJwt } from '../middleware/authenticate.js';
import { config } from '../config.js';
import { timingSafeStringCompare } from '../services/cryptoService.js';

// Enforce request rate limiting on decision queries per caller (IP/User)
const CALLER_LIMIT = 20; // 20 requests per minute
const CALLER_WINDOW_MS = 60 * 1000;
const callerStore: Record<string, number[]> = {};

function checkDecisionRateLimit(callerKey: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const timestamps = (callerStore[callerKey] ?? []).filter((ts) => now - ts < CALLER_WINDOW_MS);

    if (timestamps.length >= CALLER_LIMIT) {
        const oldest = timestamps[0];
        const retryAfter = Math.ceil((oldest + CALLER_WINDOW_MS - now) / 1000);
        return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }

    timestamps.push(now);
    callerStore[callerKey] = timestamps;
    return { allowed: true };
}

/**
 * Authentication middleware allowing both JWT (web/user) and internal secret (IPC bot engine).
 */
async function authenticateDecisionAccess(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const secretHeader = req.headers['x-internal-secret'] as string | undefined;
    const authHeader = req.headers['authorization'];
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

    const candidateSecret = secretHeader || bearer || '';
    if (config.INTERNAL_IPC_SECRET && timingSafeStringCompare(candidateSecret, config.INTERNAL_IPC_SECRET)) {
        // Internal IPC authorized
        return;
    }

    // Otherwise, require valid user JWT
    await authenticateJwt(req, reply);
}

// Zod schemas for input validation
const IntentRequestSchema = z.object({
    state: z.string().min(1).max(2000)
});

const LoanRequestSchema = z.object({
    creditScore: z.number().int().min(0).max(1000),
    reputation: z.enum(['Poor', 'Fair', 'Good', 'Excellent']),
    netWorthTier: z.enum(['low', 'medium', 'high', 'ultra']),
    requestedAmount: z.number().positive(),
    pastRepaymentsCount: z.number().int().min(0),
    pastDefaultsCount: z.number().int().min(0),
    hasCollateral: z.boolean()
});

export const decisionRoutes: FastifyPluginAsync = async (fastify) => {
    // Apply authentication preHandler to all decision endpoints
    fastify.addHook('preHandler', authenticateDecisionAccess);

    // POST /api/v1/decision/intent
    fastify.post('/intent', async (req, reply) => {
        const callerKey = (req.user?.id || req.ip || 'anonymous').toString();
        const rateCheck = checkDecisionRateLimit(callerKey);
        if (!rateCheck.allowed) {
            return reply.status(429).send({
                error: 'RATE_LIMIT_EXCEEDED',
                message: `Too many decision requests. Please retry in ${rateCheck.retryAfter}s.`
            });
        }

        const parseResult = IntentRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: 'INVALID_PAYLOAD',
                message: 'Invalid request body. Expected { state: string } (1-2000 chars).'
            });
        }

        const result = await DecisionService.classifyIntent(parseResult.data.state);
        return reply.send({ ok: true, data: result });
    });

    // POST /api/v1/decision/loan
    fastify.post('/loan', async (req, reply) => {
        const callerKey = (req.user?.id || req.ip || 'anonymous').toString();
        const rateCheck = checkDecisionRateLimit(callerKey);
        if (!rateCheck.allowed) {
            return reply.status(429).send({
                error: 'RATE_LIMIT_EXCEEDED',
                message: `Too many decision requests. Please retry in ${rateCheck.retryAfter}s.`
            });
        }

        const parseResult = LoanRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: 'INVALID_PAYLOAD',
                message: 'Invalid credit metrics payload.'
            });
        }

        const result = await DecisionService.evaluateLoan(parseResult.data);
        return reply.send({ ok: true, data: result });
    });
};
