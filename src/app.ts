import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { subscriptionRoutes, adminRoutes } from './routes/subscriptions.js';
import { groupRoutes } from './routes/groups.js';
import { subbotRoutes } from './routes/subbots.js';
import { internalRoutes } from './routes/internal.js';
import { wsRoutes } from './routes/ws.js';

export function buildApp(): FastifyInstance {
    const app = Fastify({
        logger: config.NODE_ENV !== 'test',
        trustProxy: ['127.0.0.1', '::1']
    });

    // Register CORS
    app.register(cors, {
        origin: true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    });

    // Register JWT
    app.register(jwt, {
        secret: config.JWT_SECRET
    });

    // Register WebSockets
    app.register(websocket);

    // Healthcheck endpoint
    app.get('/health', async () => {
        return { status: 'ok', service: 'cosmos-api', time: new Date().toISOString() };
    });

    // Register API routes
    app.register(authRoutes, { prefix: '/api/v1/auth' });
    app.register(subscriptionRoutes, { prefix: '/api/v1/subscriptions' });
    app.register(adminRoutes, { prefix: '/api/v1/admin' });
    app.register(groupRoutes, { prefix: '/api/v1/groups' });
    app.register(subbotRoutes, { prefix: '/api/v1/subbots' });
    app.register(internalRoutes, { prefix: '/internal' });
    app.register(wsRoutes, { prefix: '/ws' });

    return app;
}
