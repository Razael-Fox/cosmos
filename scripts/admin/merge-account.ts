import { prisma } from '../../src/db.js';

async function main() {
    const oldId = process.argv[2];
    const newId = process.argv[3];

    if (!oldId || !newId) {
        console.error('Usage: pnpm tsx scripts/admin/merge-account.ts <LID_ACCOUNT> <PN_ACCOUNT>');
        process.exit(1);
    }

    console.log(`Attempting to merge ${oldId} into ${newId}...`);

    const oldUser = await prisma.user.findUnique({ where: { id: oldId } });
    const newUser = await prisma.user.findUnique({ where: { id: newId } });

    if (!oldUser) {
        console.error(`Old account ${oldId} not found in database!`);
        process.exit(1);
    }

    if (!newUser) {
        console.log(`New account ${newId} not found. Just renaming the old one...`);
        await prisma.user.update({
            where: { id: oldId },
            data: { id: newId }
        });
        console.log('Renamed successfully.');
        process.exit(0);
    }

    console.log(`Both accounts found! Merging stats from ${oldId} to ${newId}...`);
    await prisma.user.update({
        where: { id: newId },
        data: {
            balance: { increment: oldUser.balance },
            totalWins: { increment: oldUser.totalWins },
            totalLosses: { increment: oldUser.totalLosses },
            gamesPlayed: { increment: oldUser.gamesPlayed },
            rouletteRounds: { increment: oldUser.rouletteRounds },
            rouletteWins: { increment: oldUser.rouletteWins },
            rouletteKills: { increment: oldUser.rouletteKills },
            rouletteAfk: { increment: oldUser.rouletteAfk }
        }
    });

    await prisma.user.delete({ where: { id: oldId } });
    console.log(`Successfully merged ${oldId} into ${newId}!`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
