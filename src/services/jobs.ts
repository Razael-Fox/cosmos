import { prisma } from '../db.js';
import { requireIdCard } from '../utils/idCard.js';
import { formatRupiah } from '../utils/currency.js';
import { JobCatalog } from '../generated/prisma/client.js';
import { buildUserOrConditions, getUser } from '../utils/casino.js';

export const ENTREPRENEUR_INITIAL_INVESTMENT = 250000;

type TranslateFn = (key: string, varsOrFallback?: Record<string, any> | string, vars?: Record<string, any>) => string;

function getLocalizedJobName(t: TranslateFn, name: string): string {
    switch (name) {
        case 'Mining':
            return t('tools.job.name_mining', 'Mining');
        case 'Office Work':
            return t('tools.job.name_office', 'Office Work');
        case 'Taxi Driving':
            return t('tools.job.name_taxi', 'Taxi Driving');
        case 'Cooking':
            return t('tools.job.name_cooking', 'Cooking');
        case 'Gojek':
            return t('tools.job.name_gojek', 'Gojek');
        case 'Entrepreneurship':
            return t('tools.job.name_entrepreneur', 'Entrepreneurship');
        default:
            return name;
    }
}

export interface DefaultJobConfig {
    name: string;
    description: string;
    baseSalary: bigint;
    cooldownMinutes: number;
    requiredItemId: string | null;
}

export const DEFAULT_JOBS: DefaultJobConfig[] = [
    {
        name: 'Mining',
        description:
            'Extract minerals and ores (Coal, Iron, Gold, Diamond) with high risk and reward. Requires a Pickaxe.',
        baseSalary: BigInt(333333),
        cooldownMinutes: 1440,
        requiredItemId: 'pickaxe'
    },
    {
        name: 'Office Work',
        description:
            'Corporate administrative, programming, and clerical duties with stable daily income. Requires a MacBook.',
        baseSalary: BigInt(250000),
        cooldownMinutes: 1440,
        requiredItemId: 'macbook'
    },
    {
        name: 'Taxi Driving',
        description: 'Drive passengers and navigate city traffic for daily fare income. Requires a Driver License.',
        baseSalary: BigInt(133333),
        cooldownMinutes: 1440,
        requiredItemId: 'driver_license'
    },
    {
        name: 'Cooking',
        description: 'Prepare fine culinary dishes and manage kitchen orders in restaurant kitchens.',
        baseSalary: BigInt(150000),
        cooldownMinutes: 1440,
        requiredItemId: null
    },
    {
        name: 'Gojek',
        description: 'On-demand ride-hailing and courier food delivery gig economy with frequent hourly claims.',
        baseSalary: BigInt(2500),
        cooldownMinutes: 60,
        requiredItemId: null
    },
    {
        name: 'Entrepreneurship',
        description:
            'Manage a startup enterprise. Pays weekly dividends with high market variance. Requires initial investment and MacBook or iPhone.',
        baseSalary: BigInt(1250000),
        cooldownMinutes: 10080,
        requiredItemId: 'macbook' // Also accepts iPhone
    }
];

/**
 * Ensures the default job catalog and required items exist in the database.
 */
export async function seedDefaultJobs(): Promise<void> {
    // 1. Ensure required items exist in Item catalog
    const requiredItems = [
        {
            shortId: 'pickaxe',
            name: 'Pickaxe',
            description: 'A sturdy mining pickaxe required to mine coal, iron, gold, and diamonds.',
            price: BigInt(85000),
            type: 'equipment'
        },
        {
            shortId: 'macbook',
            name: 'MacBook',
            description: 'A high-performance laptop required for office work and technology ventures.',
            price: BigInt(17999000),
            type: 'equipment'
        },
        {
            shortId: 'iphone',
            name: 'iPhone',
            description: 'A premium mobile smartphone suitable for running digital enterprises.',
            price: BigInt(12499000),
            type: 'equipment'
        },
        {
            shortId: 'driver_license',
            name: "Driver's License",
            description: 'An official driver license required for taxi and commercial transport work.',
            price: BigInt(120000),
            type: 'equipment'
        }
    ];

    for (const it of requiredItems) {
        await prisma.item.upsert({
            where: { shortId: it.shortId },
            update: {
                name: it.name,
                description: it.description,
                price: it.price,
                type: it.type,
                isAvailable: true
            },
            create: {
                shortId: it.shortId,
                name: it.name,
                description: it.description,
                price: it.price,
                type: it.type,
                isAvailable: true
            }
        });
    }

    // 2. Ensure default jobs exist
    for (const job of DEFAULT_JOBS) {
        await prisma.jobCatalog.upsert({
            where: { name: job.name },
            update: {
                description: job.description,
                baseSalary: job.baseSalary,
                cooldownMinutes: job.cooldownMinutes,
                requiredItemId: job.requiredItemId,
                isActive: true
            },
            create: {
                name: job.name,
                description: job.description,
                baseSalary: job.baseSalary,
                cooldownMinutes: job.cooldownMinutes,
                requiredItemId: job.requiredItemId,
                isActive: true
            }
        });
    }
}

/**
 * Retrieves the current economic multiplier from the database.
 */
export async function getEconomyMultiplier(): Promise<number> {
    try {
        const latestData = await prisma.economyMultiplier.findFirst({
            orderBy: { appliedAt: 'desc' }
        });
        if (latestData && latestData.multiplier > 0) {
            return latestData.multiplier;
        }
    } catch {
        // Fallback on error
    }
    return 1.0;
}

/**
 * Returns all active jobs in the catalog.
 */
export async function getJobList(): Promise<JobCatalog[]> {
    let jobs = await prisma.jobCatalog.findMany({
        where: { isActive: true },
        orderBy: { id: 'asc' }
    });

    if (jobs.length === 0) {
        await seedDefaultJobs();
        jobs = await prisma.jobCatalog.findMany({
            where: { isActive: true },
            orderBy: { id: 'asc' }
        });
    }

    return jobs;
}

/**
 * Looks up a job by numeric ID or name/alias.
 */
export async function getJobByIdOrName(query: string | number): Promise<JobCatalog | null> {
    const trimmed = String(query).trim().toLowerCase();
    if (!trimmed) return null;

    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && String(num) === trimmed) {
        return await prisma.jobCatalog.findUnique({
            where: { id: num }
        });
    }

    // Direct name lookup
    const allJobs = await getJobList();
    const exact = allJobs.find((j) => j.name.toLowerCase() === trimmed);
    if (exact) return exact;

    // Substring or alias matching
    if (trimmed.includes('miner') || trimmed.includes('mine') || trimmed.includes('tambang')) {
        return allJobs.find((j) => j.name === 'Mining') || null;
    }
    if (
        trimmed.includes('office') ||
        trimmed.includes('kantor') ||
        trimmed.includes('dev') ||
        trimmed.includes('program')
    ) {
        return allJobs.find((j) => j.name === 'Office Work') || null;
    }
    if (trimmed.includes('taxi') || trimmed.includes('taksi') || trimmed.includes('cab')) {
        return allJobs.find((j) => j.name === 'Taxi Driving') || null;
    }
    if (trimmed.includes('cook') || trimmed.includes('chef') || trimmed.includes('masak')) {
        return allJobs.find((j) => j.name === 'Cooking') || null;
    }
    if (trimmed.includes('gojek') || trimmed.includes('ojol') || trimmed.includes('ojek') || trimmed.includes('grab')) {
        return allJobs.find((j) => j.name === 'Gojek') || null;
    }
    if (
        trimmed.includes('entrepreneur') ||
        trimmed.includes('business') ||
        trimmed.includes('startup') ||
        trimmed.includes('bisnis')
    ) {
        return allJobs.find((j) => j.name === 'Entrepreneurship') || null;
    }

    return allJobs.find((j) => j.name.toLowerCase().includes(trimmed)) || null;
}

/**
 * Helper to check if a user owns an active item in their inventory.
 */
export async function userOwnsItem(userId: string, itemIdentifiers: string[]): Promise<boolean> {
    const inventory = await prisma.userInventory.findFirst({
        where: {
            userId,
            ownershipStatus: 'Owned',
            quantity: { gt: 0 },
            OR: [{ item: { shortId: { in: itemIdentifiers } } }, { name: { in: itemIdentifiers } }]
        }
    });
    return !!inventory;
}

export interface UserJobStatus {
    user: any;
    currentJob: JobCatalog | null;
    lastWorkedAt: Date | null;
    canWork: boolean;
    cooldownRemainingSeconds: number;
}

/**
 * Retrieves the current employment status of a user.
 */
export async function getUserJobStatus(userJidOrLid: string): Promise<UserJobStatus | null> {
    const user = await prisma.user.findFirst({
        where: { OR: buildUserOrConditions(userJidOrLid) },
        include: { currentJob: true }
    });

    if (!user) return null;

    let canWork = true;
    let cooldownRemainingSeconds = 0;

    if (user.currentJob && user.lastWorkedAt) {
        const cooldownMs = user.currentJob.cooldownMinutes * 60 * 1000;
        const elapsed = Date.now() - user.lastWorkedAt.getTime();
        if (elapsed < cooldownMs) {
            canWork = false;
            cooldownRemainingSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
        }
    }

    return {
        user,
        currentJob: user.currentJob,
        lastWorkedAt: user.lastWorkedAt,
        canWork,
        cooldownRemainingSeconds
    };
}

export interface ApplyJobResult {
    success: boolean;
    error?: string;
    job?: JobCatalog;
    investmentDeducted?: number;
}

/**
 * Applies for or switches to a job.
 */
export async function applyForJob(
    userJidOrLid: string,
    jobQuery: string | number,
    t: TranslateFn
): Promise<ApplyJobResult> {
    // 1. Check Virtual ID Card
    const auth = await requireIdCard(userJidOrLid, t);
    if (!auth.authorized || !auth.idCard) {
        return { success: false, error: auth.message! };
    }

    // 2. Resolve User
    let user = await prisma.user.findFirst({
        where: { OR: buildUserOrConditions(userJidOrLid) },
        include: { currentJob: true }
    });

    if (!user) {
        const createdUser = await getUser(prisma as any, userJidOrLid);
        user = { ...createdUser, currentJob: null };
    }

    const actualUserId = user.id;

    // 3. Find Job
    const job = await getJobByIdOrName(jobQuery);
    if (!job || !job.isActive) {
        return {
            success: false,
            error: t('tools.job.job_not_found', { query: String(jobQuery) })
        };
    }

    // 4. Check if already employed in this job
    if (user.currentJobId === job.id) {
        return {
            success: false,
            error: t('tools.job.already_employed', { jobName: getLocalizedJobName(t, job.name) })
        };
    }

    // 5. Verify Item & Capital Requirements
    let investmentToDeduct = 0;

    if (job.name === 'Mining') {
        const hasPickaxe = await userOwnsItem(actualUserId, ['pickaxe', 'Pickaxe']);
        if (!hasPickaxe) {
            return {
                success: false,
                error: t('tools.job.require_pickaxe')
            };
        }
    } else if (job.name === 'Office Work') {
        const hasMacBook = await userOwnsItem(actualUserId, ['macbook', 'MacBook']);
        if (!hasMacBook) {
            return {
                success: false,
                error: t('tools.job.require_macbook')
            };
        }
    } else if (job.name === 'Taxi Driving') {
        const hasLicense = await userOwnsItem(actualUserId, ['driver_license', "Driver's License", 'SIM']);
        if (!hasLicense) {
            return {
                success: false,
                error: t('tools.job.require_license')
            };
        }
    } else if (job.name === 'Entrepreneurship') {
        const hasDevice = await userOwnsItem(actualUserId, ['macbook', 'MacBook', 'iphone', 'iPhone']);
        if (!hasDevice) {
            return {
                success: false,
                error: t('tools.job.require_entrepreneur_device')
            };
        }

        if (user.balance < BigInt(ENTREPRENEUR_INITIAL_INVESTMENT)) {
            return {
                success: false,
                error: t('tools.job.require_investment', {
                    amount: formatRupiah(ENTREPRENEUR_INITIAL_INVESTMENT),
                    currentBalance: formatRupiah(user.balance)
                })
            };
        }
        investmentToDeduct = ENTREPRENEUR_INITIAL_INVESTMENT;
    }

    // 6. Execute atomic update
    await prisma.$transaction(async (tx) => {
        if (investmentToDeduct > 0) {
            const freshUser = await tx.user.findUnique({ where: { id: actualUserId } });
            if (!freshUser || freshUser.balance < BigInt(investmentToDeduct)) {
                throw new Error('INSUFFICIENT_INVESTMENT_FUNDS');
            }
            await tx.user.update({
                where: { id: actualUserId },
                data: {
                    balance: { decrement: BigInt(investmentToDeduct) },
                    currentJobId: job.id
                }
            });
            await tx.activityLog.create({
                data: {
                    userId: actualUserId,
                    type: 'BUSINESS_INVESTMENT',
                    amount: BigInt(investmentToDeduct),
                    description: `Initial capital investment for ${job.name}`
                }
            });
        } else {
            await tx.user.update({
                where: { id: actualUserId },
                data: { currentJobId: job.id }
            });
        }

        await tx.activityLog.create({
            data: {
                userId: actualUserId,
                type: 'JOB_APPLY',
                description: `Successfully applied and joined position as ${job.name}`
            }
        });
    });

    return {
        success: true,
        job,
        investmentDeducted: investmentToDeduct > 0 ? investmentToDeduct : undefined
    };
}

export interface ResignJobResult {
    success: boolean;
    error?: string;
    previousJobName?: string;
}

/**
 * Resigns from the current job.
 */
export async function resignJob(userJidOrLid: string, t: TranslateFn): Promise<ResignJobResult> {
    const user = await prisma.user.findFirst({
        where: { OR: buildUserOrConditions(userJidOrLid) },
        include: { currentJob: true }
    });

    if (!user || !user.currentJob) {
        return {
            success: false,
            error: t('tools.job.not_employed')
        };
    }

    const previousJobName = user.currentJob.name;

    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id: user.id },
            data: { currentJobId: null }
        });
        await tx.activityLog.create({
            data: {
                userId: user.id,
                type: 'JOB_RESIGN',
                description: `Resigned from position as ${previousJobName}`
            }
        });
    });

    return {
        success: true,
        previousJobName
    };
}

export interface WorkResult {
    success: boolean;
    error?: string;
    cooldownRemainingSeconds?: number;
    jobName?: string;
    payout?: number;
    baseSalary?: number;
    multiplier?: number;
    narrative?: string;
    newBalance?: bigint;
    varianceDetail?: string;
}

/**
 * Executes a work shift for the user.
 */
export async function executeWork(userJidOrLid: string, t: TranslateFn): Promise<WorkResult> {
    // 1. Check Virtual ID Card
    const auth = await requireIdCard(userJidOrLid, t);
    if (!auth.authorized || !auth.idCard) {
        return { success: false, error: auth.message! };
    }

    // 2. Resolve User & Current Job
    const user = await prisma.user.findFirst({
        where: { OR: buildUserOrConditions(userJidOrLid) },
        include: { currentJob: true }
    });

    if (!user || !user.currentJob) {
        return {
            success: false,
            error: t('tools.work.not_employed')
        };
    }

    const job = user.currentJob;
    const actualUserId = user.id;

    // 3. Check Cooldown
    const cooldownMs = job.cooldownMinutes * 60 * 1000;
    if (user.lastWorkedAt) {
        const elapsed = Date.now() - user.lastWorkedAt.getTime();
        if (elapsed < cooldownMs) {
            const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
            return {
                success: false,
                cooldownRemainingSeconds: remainingSec,
                error: t('tools.work.cooldown_active', {
                    remaining: formatRemainingTime(remainingSec)
                })
            };
        }
    }

    // 4. Re-verify item requirements
    if (job.name === 'Mining') {
        const hasPickaxe = await userOwnsItem(actualUserId, ['pickaxe', 'Pickaxe']);
        if (!hasPickaxe) {
            return { success: false, error: t('tools.job.require_pickaxe') };
        }
    } else if (job.name === 'Office Work') {
        const hasMacBook = await userOwnsItem(actualUserId, ['macbook', 'MacBook']);
        if (!hasMacBook) {
            return { success: false, error: t('tools.job.require_macbook') };
        }
    } else if (job.name === 'Taxi Driving') {
        const hasLicense = await userOwnsItem(actualUserId, ['driver_license', "Driver's License", 'SIM']);
        if (!hasLicense) {
            return { success: false, error: t('tools.job.require_license') };
        }
    } else if (job.name === 'Entrepreneurship') {
        const hasDevice = await userOwnsItem(actualUserId, ['macbook', 'MacBook', 'iphone', 'iPhone']);
        if (!hasDevice) {
            return { success: false, error: t('tools.job.require_entrepreneur_device') };
        }
    }

    // 5. Calculate Dynamic Payout with Multiplier
    const multiplier = await getEconomyMultiplier();
    let payout = 0;
    let baseAmount = Number(job.baseSalary);
    let narrative: string;
    let varianceDetail = '';

    if (job.name === 'Mining') {
        // High variance mining yields: Coal (40%), Iron (30%), Gold (20%), Diamond (10%)
        const roll = Math.random() * 100;
        let oreName: string;
        let oreBase: number;

        if (roll < 10) {
            oreName = t('tools.work.ore_diamond', 'Diamond');
            oreBase = 666666;
            varianceDetail = t('tools.work.variance_mining_diamond');
        } else if (roll < 30) {
            oreName = t('tools.work.ore_gold', 'Gold');
            oreBase = 333333;
            varianceDetail = t('tools.work.variance_mining_gold');
        } else if (roll < 60) {
            oreName = t('tools.work.ore_coal', 'Coal');
            oreBase = 233333;
            varianceDetail = t('tools.work.variance_mining_coal');
        } else {
            oreName = t('tools.work.ore_iron', 'Iron');
            oreBase = 166666;
            varianceDetail = t('tools.work.variance_mining_iron');
        }

        baseAmount = oreBase;
        payout = Math.max(1, Math.round(oreBase * multiplier));
        narrative = t('tools.work.narrative_mining', {
            ore: oreName,
            amount: formatRupiah(payout)
        });
    } else if (job.name === 'Office Work') {
        baseAmount = 250000;
        payout = Math.max(1, Math.round(baseAmount * multiplier));
        narrative = t('tools.work.narrative_office', {
            amount: formatRupiah(payout)
        });
    } else if (job.name === 'Taxi Driving') {
        baseAmount = 133333;
        payout = Math.max(1, Math.round(baseAmount * multiplier));
        narrative = t('tools.work.narrative_taxi', {
            amount: formatRupiah(payout)
        });
    } else if (job.name === 'Cooking') {
        baseAmount = 150000;
        payout = Math.max(1, Math.round(baseAmount * multiplier));
        narrative = t('tools.work.narrative_cooking', {
            amount: formatRupiah(payout)
        });
    } else if (job.name === 'Gojek') {
        const baseGig = 2500;
        const tip = Math.floor(Math.random() * 1500);
        baseAmount = baseGig + tip;
        payout = Math.max(1, Math.round(baseAmount * multiplier));
        narrative = t('tools.work.narrative_gojek', {
            amount: formatRupiah(payout),
            tip: formatRupiah(tip)
        });
    } else if (job.name === 'Entrepreneurship') {
        // High risk & reward business cycles:
        // Boom (15%): 1.8x, Normal (65%): 1.0x, Lean (15%): 0.4x, Deficit (5%): 0
        const roll = Math.random() * 100;
        let factor: number;

        if (roll < 15) {
            factor = 1.8;
            varianceDetail = t('tools.work.variance_entre_boom');
        } else if (roll < 80) {
            factor = 1.0 + Math.random() * 0.3; // 1.0 - 1.3
            varianceDetail = t('tools.work.variance_entre_steady');
        } else if (roll < 95) {
            factor = 0.4;
            varianceDetail = t('tools.work.variance_entre_lean');
        } else {
            factor = 0;
            varianceDetail = t('tools.work.variance_entre_deficit');
        }

        baseAmount = Math.round(Number(job.baseSalary) * factor);
        payout = Math.round(baseAmount * multiplier);
        narrative = t('tools.work.narrative_entrepreneur', {
            amount: formatRupiah(payout)
        });
    } else {
        payout = Math.max(1, Math.round(baseAmount * multiplier));
        narrative = t('tools.work.narrative_default', {
            jobName: getLocalizedJobName(t, job.name),
            amount: formatRupiah(payout)
        });
    }

    // 6. Commit Database Updates
    const updatedUser = await prisma.$transaction(async (tx) => {
        const fresh = await tx.user.update({
            where: { id: actualUserId },
            data: {
                balance: { increment: BigInt(payout) },
                lastWorkedAt: new Date()
            }
        });

        if (payout > 0) {
            await tx.activityLog.create({
                data: {
                    userId: actualUserId,
                    type: 'JOB_SALARY',
                    amount: BigInt(payout),
                    description: `Earned salary working as ${job.name}`
                }
            });
        }

        return fresh;
    });

    return {
        success: true,
        jobName: job.name,
        payout,
        baseSalary: baseAmount,
        multiplier,
        narrative,
        newBalance: updatedUser.balance,
        varianceDetail: varianceDetail || undefined
    };
}

/**
 * Format remaining seconds into a human-readable string.
 */
export function formatRemainingTime(totalSeconds: number): string {
    if (totalSeconds <= 0) return '0s';

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 && days === 0) parts.push(`${seconds}s`);

    return parts.join(' ') || `${totalSeconds}s`;
}
