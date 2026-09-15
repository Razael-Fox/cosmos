import { prisma } from './db.js';

export const INITIAL_PROPERTIES = [
    {
        name: 'Honda Scoopy Motorcycle',
        typeCategory: 'Vehicle',
        basePrice: 23681000,
        baseDepreciationRate: 0.02
    },
    {
        name: 'Rolex Submariner Watch',
        typeCategory: 'Luxury',
        basePrice: 185000000,
        baseDepreciationRate: 0.01
    },
    {
        name: 'iPhone 15 Pro Max',
        typeCategory: 'Electronics',
        basePrice: 19999000,
        baseDepreciationRate: 0.03
    },
    {
        name: 'Google Pixel 9a',
        typeCategory: 'Electronics',
        basePrice: 7999000,
        baseDepreciationRate: 0.03
    },
    {
        name: 'MacBook Pro M3 Max',
        typeCategory: 'Electronics',
        basePrice: 59999000,
        baseDepreciationRate: 0.02
    },
    {
        name: 'Bali Beach Villa',
        typeCategory: 'Real Estate',
        basePrice: 4250000000,
        baseDepreciationRate: 0.01
    }
];

export async function seedProperties() {
    console.log('Seeding property catalog...');

    for (const p of INITIAL_PROPERTIES) {
        const existing = await prisma.propertyCatalog.findFirst({
            where: { name: p.name }
        });

        if (existing) {
            await prisma.propertyCatalog.update({
                where: { id: existing.id },
                data: {
                    typeCategory: p.typeCategory,
                    basePrice: BigInt(p.basePrice),
                    baseDepreciationRate: p.baseDepreciationRate
                }
            });
            console.log(`Updated property: ${p.name}`);
        } else {
            await prisma.propertyCatalog.create({
                data: {
                    name: p.name,
                    typeCategory: p.typeCategory,
                    basePrice: BigInt(p.basePrice),
                    baseDepreciationRate: p.baseDepreciationRate
                }
            });
            console.log(`Created property: ${p.name}`);
        }
    }

    console.log('Property catalog seeded successfully.');
}

// Allow running directly as a script
if (process.argv[1] && process.argv[1].endsWith('seed_property.ts')) {
    seedProperties()
        .catch((e) => {
            console.error('Error seeding properties:', e);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
