import { prisma } from '../../src/db.js';

async function main() {
    console.log('Migrating user IDs to be domain-less (fixing LID vs JID split)...');
    const users = await prisma.user.findMany();
    let migrated = 0;

    for (const user of users) {
        if (user.id.includes('@')) {
            const newId = user.id.split(':')[0].split('@')[0];

            // Check if newId already exists (e.g. they already have an LID and JID account split)
            const existing = await prisma.user.findUnique({ where: { id: newId } });

            if (existing) {
                console.log(`Conflict for ${newId}: Merging balances and stats...`);
                await prisma.user.update({
                    where: { id: newId },
                    data: {
                        balance: { increment: user.balance },
                        totalWins: { increment: user.totalWins },
                        totalLosses: { increment: user.totalLosses },
                        gamesPlayed: { increment: user.gamesPlayed },
                        rouletteRounds: { increment: user.rouletteRounds },
                        rouletteWins: { increment: user.rouletteWins },
                        rouletteKills: { increment: user.rouletteKills },
                        rouletteAfk: { increment: user.rouletteAfk }
                    }
                });
                await prisma.user.delete({ where: { id: user.id } });
            } else {
                console.log(`Updating ${user.id} -> ${newId}`);
                try {
                    await prisma.user.update({
                        where: { id: user.id },
                        data: { id: newId }
                    });
                } catch {
                    console.log(`Update failed, recreating ${user.id} as ${newId}`);
                    const { createdAt: _c, updatedAt: _u, ...userData } = user;
                    await prisma.user.create({ data: { ...userData, id: newId } });
                    await prisma.user.delete({ where: { id: user.id } });
                }
            }
            migrated++;
        }
    }
    console.log(`Migrated ${migrated} users.`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
