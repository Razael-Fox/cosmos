import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';

export interface JwtUserPayload {
    id: string; // WhatsApp JID (e.g. 628123456789@s.whatsapp.net)
    phoneNumber?: string;
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: JwtUserPayload;
        user: JwtUserPayload;
    }
}

export async function authenticateJwt(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
        await req.jwtVerify();
    } catch {
        reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token.' });
        return;
    }

    if (!req.user || !req.user.id) {
        reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid authentication payload.' });
        return;
    }

    // Verify user still exists in database
    const user = await prisma.user.findUnique({ where: { id: req.user.id } }).catch(() => null);
    if (!user) {
        reply.status(401).send({ error: 'USER_NOT_FOUND', message: 'User account no longer exists.' });
        return;
    }
}
