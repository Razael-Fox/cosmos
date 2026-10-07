import { prisma } from '../../src/db.js';

async function main() {
    console.log('Checking database columns for i18n...');
    try {
        await prisma.$executeRawUnsafe("ALTER TABLE User ADD COLUMN language TEXT NOT NULL DEFAULT 'ID'");
        console.log('Added language column to User.');
    } catch (e: any) {
        console.log('User language column check:', e.message);
    }

    try {
        await prisma.$executeRawUnsafe("ALTER TABLE WhitelistedGroup ADD COLUMN language TEXT NOT NULL DEFAULT 'ID'");
        console.log('Added language column to WhitelistedGroup.');
    } catch (e: any) {
        console.log('WhitelistedGroup language column check:', e.message);
    }

    const userCols = (await prisma.$queryRawUnsafe('PRAGMA table_info(User)')) as any[];
    console.log(
        'User columns:',
        userCols.map((c) => c.name)
    );

    const groupCols = (await prisma.$queryRawUnsafe('PRAGMA table_info(WhitelistedGroup)')) as any[];
    console.log(
        'WhitelistedGroup columns:',
        groupCols.map((c) => c.name)
    );
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
