import assert from 'assert';
import { prisma } from '../src/db.js';
import { saveIdCard } from '../src/lib/idCard.js';
import {
    seedDefaultJobs,
    getJobList,
    getUserJobStatus,
    applyForJob,
    resignJob,
    executeWork,
    ENTREPRENEUR_INITIAL_INVESTMENT
} from '../src/services/jobs.js';
import jobTool from '../src/commands/employment/job.js';
import workTool from '../src/commands/employment/work.js';
import applyLicenseTool from '../src/commands/employment/applyLicense.js';
import { getTranslator } from '../src/lib/i18n.js';

async function runJobTests() {
    console.log('=== STARTING JOB & SALARY SYSTEM TESTS ===');
    const t = getTranslator('en');
    const timestamp = Date.now();

    const userWithKtp = `user_job_${timestamp}@s.whatsapp.net`;
    const userNoKtp = `user_noktp_${timestamp}@s.whatsapp.net`;

    // 1. Seed jobs and items
    console.log('[Test 1] Seeding jobs & required items...');
    await seedDefaultJobs();
    const jobList = await getJobList();
    assert(jobList.length >= 6, `Expected at least 6 jobs, got ${jobList.length}`);
    console.log(`✓ Default jobs verified (${jobList.length} jobs present).`);

    // 2. Setup users in database
    console.log('[Test 2] Setting up test users in database...');
    await prisma.user.create({
        data: {
            id: userWithKtp,
            pushName: 'Worker John',
            balance: BigInt(500000)
        }
    });

    await prisma.user.create({
        data: {
            id: userNoKtp,
            pushName: 'Unregistered User',
            balance: BigInt(500000)
        }
    });

    // Provide ID card for userWithKtp (born 1995, age > 17)
    await saveIdCard({
        nik: `317101010195${String(timestamp % 9000).padStart(4, '0')}`,
        userJid: userWithKtp,
        fullName: 'John Worker',
        placeOfBirth: 'Jakarta',
        dateOfBirth: '01-01-1995',
        gender: 'LAKI-LAKI',
        address: 'Jl. Merdeka No. 1',
        religion: 'ISLAM',
        maritalStatus: 'BELUM KAWIN',
        occupation: 'Karyawan Swasta'
    });
    console.log('✓ Test users created.');

    // 3. ID Card Verification Gate
    console.log('[Test 3] Testing ID Card verification gate for job application and work...');
    const noKtpApply = await applyForJob(userNoKtp, 1, t);
    assert.strictEqual(noKtpApply.success, false, 'User without ID Card must not be able to apply');
    assert(noKtpApply.error?.includes('Virtual ID Card') || noKtpApply.error?.includes('Access Denied'));

    const noKtpWork = await executeWork(userNoKtp, t);
    assert.strictEqual(noKtpWork.success, false, 'User without ID Card must not be able to work');
    console.log('✓ ID Card requirement strictly enforced.');

    // 4. Mining requirement (Pickaxe)
    console.log('[Test 4] Testing Mining job item requirement (Pickaxe)...');
    const applyMiningNoPickaxe = await applyForJob(userWithKtp, 'Mining', t);
    assert.strictEqual(applyMiningNoPickaxe.success, false, 'Should fail without Pickaxe');
    assert(applyMiningNoPickaxe.error?.includes('Pickaxe'));

    // Grant pickaxe to user
    const pickaxeItem = await prisma.item.findUnique({ where: { shortId: 'pickaxe' } });
    assert(pickaxeItem, 'Pickaxe item must exist in database');
    await prisma.userInventory.create({
        data: {
            userId: userWithKtp,
            itemId: pickaxeItem.id,
            name: pickaxeItem.name,
            typeCategory: pickaxeItem.type,
            quantity: 1,
            ownershipStatus: 'Owned'
        }
    });

    const applyMiningSuccess = await applyForJob(userWithKtp, 'Mining', t);
    assert.strictEqual(applyMiningSuccess.success, true, 'Should succeed with Pickaxe');
    assert.strictEqual(applyMiningSuccess.job?.name, 'Mining');

    // Duplicate apply
    const duplicateApply = await applyForJob(userWithKtp, 'Mining', t);
    assert.strictEqual(duplicateApply.success, false, 'Should reject duplicate apply');
    console.log('✓ Mining application and item requirement verified.');

    // 5. Work shift execution & dynamic salary
    console.log('[Test 5] Testing .work command and dynamic salary calculation...');
    const userBeforeWork = await prisma.user.findUnique({ where: { id: userWithKtp } });
    const workResult = await executeWork(userWithKtp, t);
    assert.strictEqual(workResult.success, true, 'Work execution should succeed');
    assert(workResult.payout! > 0, 'Payout must be positive');
    assert(workResult.newBalance! > userBeforeWork!.balance, 'Balance must increase');
    assert(workResult.multiplier! > 0, 'Multiplier must be positive');
    console.log(`✓ Work completed: earned ${workResult.payout} (Multiplier: ${workResult.multiplier}x).`);

    // 6. Cooldown enforcement
    console.log('[Test 6] Testing work shift cooldown...');
    const immediateWork = await executeWork(userWithKtp, t);
    assert.strictEqual(immediateWork.success, false, 'Immediate second work must be rejected by cooldown');
    assert(immediateWork.cooldownRemainingSeconds! > 0, 'Remaining cooldown must be positive');
    console.log(`✓ Cooldown active: ${immediateWork.cooldownRemainingSeconds}s remaining.`);

    // 7. Driver license integration & Taxi Driving
    console.log('[Test 7] Testing driver license application & Taxi Driving job...');
    const fakeCtx = {
        msg: {
            key: { remoteJid: userWithKtp, participant: userWithKtp },
            pushName: 'Worker John'
        },
        sock: {},
        jid: userWithKtp,
        t
    };

    const licenseApplyMsg = await applyLicenseTool.execute({ licenseType: 'A' }, fakeCtx as any);
    assert(licenseApplyMsg.includes('SIM A') || licenseApplyMsg.includes('virtual driving test'));

    // Check inventory for Driver's License
    const licenseInv = await prisma.userInventory.findFirst({
        where: {
            userId: userWithKtp,
            item: { shortId: 'driver_license' }
        }
    });
    assert(licenseInv, 'Driver license must now be in inventory');

    // Apply for Taxi Driving
    const taxiApply = await applyForJob(userWithKtp, 'Taxi Driving', t);
    assert.strictEqual(taxiApply.success, true, 'Should succeed with Driver License');
    assert.strictEqual(taxiApply.job?.name, 'Taxi Driving');
    console.log('✓ Driver License application & Taxi Driving switch verified.');

    // 8. Entrepreneurship capital & device requirement
    console.log('[Test 8] Testing Entrepreneurship investment and device check...');
    // Currently user has no MacBook or iPhone
    const entrepreneurNoDevice = await applyForJob(userWithKtp, 'Entrepreneurship', t);
    assert.strictEqual(entrepreneurNoDevice.success, false, 'Should fail without device');

    // Grant iPhone
    const iphoneItem = await prisma.item.findUnique({ where: { shortId: 'iphone' } });
    assert(iphoneItem, 'iPhone item must exist');
    await prisma.userInventory.create({
        data: {
            userId: userWithKtp,
            itemId: iphoneItem.id,
            name: iphoneItem.name,
            typeCategory: iphoneItem.type,
            quantity: 1,
            ownershipStatus: 'Owned'
        }
    });

    const balanceBeforeInvest = (await prisma.user.findUnique({ where: { id: userWithKtp } }))!.balance;
    const entrepreneurSuccess = await applyForJob(userWithKtp, 'Entrepreneurship', t);
    assert.strictEqual(entrepreneurSuccess.success, true, 'Should succeed with device & capital');
    const balanceAfterInvest = (await prisma.user.findUnique({ where: { id: userWithKtp } }))!.balance;
    assert.strictEqual(
        balanceBeforeInvest - balanceAfterInvest,
        BigInt(ENTREPRENEUR_INITIAL_INVESTMENT),
        'Initial investment capital must be deducted'
    );
    console.log('✓ Entrepreneurship device requirement and capital deduction verified.');

    // 9. Resign job
    console.log('[Test 9] Testing job resignation...');
    const resignResult = await resignJob(userWithKtp, t);
    assert.strictEqual(resignResult.success, true, 'Resignation should succeed');
    assert.strictEqual(resignResult.previousJobName, 'Entrepreneurship');

    const statusAfterResign = await getUserJobStatus(userWithKtp);
    assert.strictEqual(statusAfterResign?.currentJob, null, 'User should now be unemployed');
    console.log('✓ Job resignation verified.');

    // 10. CLI Tools Execution (.job and .work)
    console.log('[Test 10] Testing tool execute handlers for .job and .work...');
    // .job list
    const listOutput = await jobTool.execute({ action: 'list' }, fakeCtx as any);
    assert(listOutput.includes('Mining') && listOutput.includes('Office Work'));

    // .job status while unemployed
    const statusOutput = await jobTool.execute({}, fakeCtx as any);
    assert(statusOutput.includes('Unemployed'));

    // .job join Gojek
    const joinOutput = await jobTool.execute({ action: 'join', target: 'Gojek' }, fakeCtx as any);
    assert(joinOutput.includes('Gojek'));

    // .work tool output
    // Reset lastWorkedAt so work can proceed
    await prisma.user.update({
        where: { id: userWithKtp },
        data: { lastWorkedAt: null }
    });
    const workOutput = await workTool.execute({}, fakeCtx as any);
    assert(workOutput.includes('Gojek') && workOutput.includes('Rp'));
    console.log('✓ .job and .work tool commands verified.');

    console.log('=== ALL JOB & SALARY SYSTEM TESTS PASSED SUCCESSFULLY! ===');
}

runJobTests()
    .catch((err) => {
        console.error('Job system test failed:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
