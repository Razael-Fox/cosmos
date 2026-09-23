import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { getSenderJid } from '#utils/casino.js';
import { requireIdCard, calculateAge } from '#utils/idCard.js';
import { getTranslator } from '#utils/i18n.js';
import { prisma } from '#db.js';

export const definition: ToolDefinition = {
    name: 'apply license',
    title: 'Driver License Application',
    displayNames: {
        en: 'apply license',
        id: 'pasang sim'
    },
    category: 'Licensing',
    aliases: [
        'apply license',
        'pasang sim',
        'buat sim',
        'ajukan sim',
        'daftar sim',
        'apply-license',
        'applylicense',
        'sim'
    ],
    description: 'Apply for a virtual driver license. Requires a valid Virtual ID Card and age >= 17.',
    descriptionKey: 'tools.commands.apply_license.description',
    parameters: {
        type: 'object',
        properties: {
            licenseType: {
                type: 'string',
                description: 'Optional license category (e.g. A, C).'
            }
        }
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const t = ctx?.t || getTranslator('en');
    const senderJid = getSenderJid(ctx.msg, ctx.sock);
    if (!senderJid) {
        return t('core.sender_identity_error');
    }

    // Step 1: Verification Hook (IdCard Requirement)
    const auth = await requireIdCard(senderJid, t);
    if (!auth.authorized || !auth.idCard) {
        return auth.message!;
    }

    const { idCard } = auth;

    // Step 2: Calculate user's age from dateOfBirth with month/day precision
    const age = calculateAge(idCard.dateOfBirth);

    if (age < 17) {
        return t('tools.apply_license.age_denied', { age });
    }

    const licenseType = (args.licenseType || 'A').toUpperCase().trim();

    // Ensure driver_license exists in Item catalog
    let licenseItem = await prisma.item.findUnique({ where: { shortId: 'driver_license' } });
    if (!licenseItem) {
        licenseItem = await prisma.item.create({
            data: {
                shortId: 'driver_license',
                name: "Driver's License",
                description: 'An official driver license required for taxi and commercial transport work.',
                price: BigInt(100000),
                type: 'equipment',
                isAvailable: true
            }
        });
    }

    // Grant Driver's License to user inventory
    await prisma.userInventory.upsert({
        where: {
            userId_itemId: {
                userId: auth.idCard.userJid,
                itemId: licenseItem.id
            }
        },
        create: {
            userId: auth.idCard.userJid,
            itemId: licenseItem.id,
            quantity: 1,
            name: licenseItem.name,
            typeCategory: 'equipment',
            originalPrice: licenseItem.price,
            ownershipStatus: 'Owned'
        },
        update: {
            ownershipStatus: 'Owned'
        }
    });

    return t('tools.apply_license.success', {
        name: idCard.fullName,
        age,
        type: licenseType
    });
}

const applyLicenseTool: ToolModule = {
    definition,
    execute
};

export default applyLicenseTool;
