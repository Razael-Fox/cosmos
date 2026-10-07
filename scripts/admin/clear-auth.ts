import { prisma } from '../../src/db.js';

async function clear() {
    await prisma.whatsAppAuth.deleteMany({});
    console.log('Cleared WhatsAppAuth table.');
}

clear().catch(console.error);
