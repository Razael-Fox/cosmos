import { prisma } from '../../src/db.js';

async function main() {
    console.log('Starting migration to IDR...');

    // Update users
    const users = await prisma.user.findMany();
    let userCount = 0;
    for (const user of users) {
        // Assume balance is stored as a number (since we just generated client but old values might need to be cast if using bigInt)
        // Since we changed schema to BigInt, we need to read it and multiply
        const currentBalance = Number(user.balance);
        const newBalance = Math.floor(currentBalance * 17775.15);
        await prisma.user.update({
            where: { id: user.id },
            data: { balance: BigInt(newBalance) }
        });
        userCount++;
    }
    console.log(`Migrated ${userCount} users.`);

    // Update house vault
    const vault = await prisma.houseVault.findUnique({ where: { id: 1 } });
    if (vault) {
        await prisma.houseVault.update({
            where: { id: 1 },
            data: {
                income: BigInt(Math.floor(Number(vault.income) * 17775.15)),
                payout: BigInt(Math.floor(Number(vault.payout) * 17775.15)),
                netProfit: BigInt(Math.floor(Number(vault.netProfit) * 17775.15))
            }
        });
        console.log('Migrated house vault.');
    }

    console.log('Migration complete!');
}

main()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
