import { prisma } from './db.js';

export const INITIAL_ITEMS = [
    {
        name: 'Gorengan',
        shortId: 'gorengan',
        description: 'Authentic Indonesian fried snacks. Restores 1.5 health.',
        type: 'consumable',
        price: BigInt(2500),
        isAvailable: true
    },
    {
        name: 'Yakult',
        shortId: 'yakult',
        description: 'A probiotic dairy drink. Restores 2.5 health.',
        type: 'consumable',
        price: BigInt(3000),
        isAvailable: true
    },
    {
        name: 'Tolak Angin',
        shortId: 'tolakangin',
        description: 'Herbal remedy to cure debuffs and restore 5 health.',
        type: 'consumable',
        price: BigInt(5000),
        isAvailable: true
    },
    {
        name: 'Indomie Goreng',
        shortId: 'indomie',
        description: 'The ultimate comfort food. Restores 10 health.',
        type: 'consumable',
        price: BigInt(4000),
        isAvailable: true
    },
    {
        name: 'Bambu Runcing',
        shortId: 'bambu',
        description: 'A traditional bamboo spear for combat.',
        type: 'equipment',
        price: BigInt(25000),
        isAvailable: true
    },
    {
        name: 'Sandal Swallow',
        shortId: 'swallow',
        description: 'Legendary rubber sandals. Good for defense.',
        type: 'equipment',
        price: BigInt(18000),
        isAvailable: true
    },
    {
        name: 'Sarung BHS',
        shortId: 'sarung',
        description: 'A high-quality woven sarong, perfect for flexing.',
        type: 'collectible',
        price: BigInt(650000),
        isAvailable: true
    },
    {
        name: 'Pickaxe',
        shortId: 'pickaxe',
        description: 'A sturdy mining pickaxe required to mine coal, iron, gold, and diamonds.',
        type: 'equipment',
        price: BigInt(85000),
        isAvailable: true
    },
    {
        name: 'MacBook',
        shortId: 'macbook',
        description: 'A high-performance laptop required for office work and technology ventures.',
        type: 'equipment',
        price: BigInt(17999000),
        isAvailable: true
    },
    {
        name: 'iPhone',
        shortId: 'iphone',
        description: 'A premium mobile smartphone suitable for running digital enterprises.',
        type: 'equipment',
        price: BigInt(12499000),
        isAvailable: true
    },
    {
        name: 'Google Pixel 9a',
        shortId: 'pixel9a',
        description: 'An affordable Android smartphone suitable for running digital enterprises.',
        type: 'equipment',
        price: BigInt(7999000),
        isAvailable: true
    },
    {
        name: "Driver's License",
        shortId: 'driver_license',
        description: 'An official driver license required for taxi and commercial transport work.',
        type: 'equipment',
        price: BigInt(120000),
        isAvailable: true
    }
];

export async function seedItems() {
    console.log('Seeding initial shop items...');

    for (const item of INITIAL_ITEMS) {
        await prisma.item.upsert({
            where: { shortId: item.shortId },
            update: {
                name: item.name,
                description: item.description,
                type: item.type,
                price: item.price,
                isAvailable: item.isAvailable
            },
            create: {
                name: item.name,
                shortId: item.shortId,
                description: item.description,
                type: item.type,
                price: item.price,
                isAvailable: item.isAvailable
            }
        });
        console.log(`Upserted item: ${item.name} (${item.shortId})`);
    }

    console.log('Shop items seeded successfully.');
}

// Allow running directly as a script
if (process.argv[1] && process.argv[1].endsWith('seed_item.ts')) {
    seedItems()
        .catch((err) => {
            console.error('Error seeding items:', err);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
