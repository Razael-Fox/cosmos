import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';

const app = buildApp();

async function start(): Promise<void> {
    try {
        await app.listen({ port: config.PORT, host: config.HOST });
        console.log(`[Cosmos API] Gateway listening at http://${config.HOST}:${config.PORT}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

// Graceful shutdown handling
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
for (const signal of signals) {
    process.on(signal, async () => {
        console.log(`[Cosmos API] Received ${signal}, closing server gracefully...`);
        try {
            await app.close();
            await prisma.$disconnect();
            console.log('[Cosmos API] Shutdown complete.');
            process.exit(0);
        } catch (err) {
            console.error('[Cosmos API] Error during shutdown:', err);
            process.exit(1);
        }
    });
}

start();
