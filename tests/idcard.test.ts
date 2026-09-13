import assert from 'assert';
import sharp from 'sharp';
import { prisma } from '../src/db.js';
import {
    generateNik,
    saveIdCard,
    getIdCardByUser,
    requireIdCard,
    startRegistrationSession,
    isUserRegistering,
    processRegistrationStep,
    parseBirthPlaceAndDate,
    calculateAge
} from '../src/utils/idCard.js';
import { generateIdCardImage, createPlaceholderPhotoBuffer } from '../src/utils/imageProcessing.js';
import { formatMentions, cleanId } from '../src/utils/casino.js';
import idCardTool from '../src/tools/idcard.js';
import loanTool from '../src/tools/loan.js';
import applyLicenseTool from '../src/tools/apply_license.js';
import jobTool from '../src/tools/job.js';

async function runTests() {
    console.log('--- STARTING ENHANCED VIRTUAL ID CARD TESTS ---');

    const testJid = `test_user_${Date.now()}@s.whatsapp.net`;
    const testJidClean = testJid.split('@')[0];

    // 1. Test Date Parsing & Normalization
    console.log('[Test 1] Testing date parsing, text month normalization, and age calculations...');
    const parsed1 = parseBirthPlaceAndDate('Jakarta, 17-08-1990');
    assert(parsed1, 'Should parse DD-MM-YYYY');
    assert.strictEqual(parsed1.place, 'JAKARTA');
    assert.strictEqual(parsed1.formattedDob, '17-08-1990');

    const parsed2 = parseBirthPlaceAndDate('Surabaya, 20 November 2002');
    assert(parsed2, 'Should parse text month');
    assert.strictEqual(parsed2.place, 'SURABAYA');
    assert.strictEqual(parsed2.formattedDob, '20-11-2002');

    const parsed3 = parseBirthPlaceAndDate('Bandung 17/08/1990');
    assert(parsed3, 'Should parse slash separated date');
    assert.strictEqual(parsed3.place, 'BANDUNG');
    assert.strictEqual(parsed3.formattedDob, '17-08-1990');

    const parsedInvalid = parseBirthPlaceAndDate('Jakarta only');
    assert.strictEqual(parsedInvalid, null, 'Should reject input with no date');

    const parsedInvalidDate = parseBirthPlaceAndDate('Jakarta, 32-13-1990');
    assert.strictEqual(parsedInvalidDate, null, 'Should reject invalid day/month values');

    // Test precise age boundary calculation
    // A person born on December 31, 2009 is NOT 17 if today is before December 31, 2026
    const underAge = calculateAge('31-12-2009');
    const today = new Date();
    if (today.getMonth() < 11 || (today.getMonth() === 11 && today.getDate() < 31)) {
        assert.strictEqual(underAge, 16, 'Exact age boundary must reflect 16 years old before birthday');
    }
    const adultAge = calculateAge('01-01-2000');
    assert(adultAge >= 24, 'Age should be at least 24 for 2000 birth year');
    console.log('✓ Date parsing and boundary calculations verified successfully.');

    // 2. Test NIK Generation
    console.log('[Test 2] Testing NIK generation with standard and text-month dates...');
    const maleNik = await generateNik('LAKI-LAKI', '17-08-1990');
    assert.strictEqual(maleNik.length, 16, 'NIK must be 16 digits');
    assert.strictEqual(maleNik.startsWith('317101'), true, 'NIK must start with Cosmos area code 317101');
    assert.strictEqual(maleNik.slice(6, 12), '170890', 'Male birth date in NIK should be 170890');

    const femaleNik = await generateNik('PEREMPUAN', '17-08-1990');
    assert.strictEqual(femaleNik.length, 16, 'Female NIK must be 16 digits');
    assert.strictEqual(femaleNik.slice(6, 12), '570890', 'Female birth date day in NIK should be day + 40 (57)');

    // Test NIK generation with text month input
    const femaleTextMonthNik = await generateNik('Female', '17 Agustus 1990');
    assert.strictEqual(
        femaleTextMonthNik.slice(6, 12),
        '570890',
        'Female birth date with Indonesian month should be 570890'
    );
    console.log('✓ NIK generation verified successfully.');

    // 3. Test Verification Hook when ID card does not exist (Scenario D)
    console.log('[Test 3] Testing Graceful Rejection for unregistered user (Scenario D)...');
    const authBefore = await requireIdCard(testJidClean);
    assert.strictEqual(authBefore.authorized, false);
    assert.strictEqual(
        authBefore.message,
        'Access Denied. You must possess a Virtual ID Card to use this feature. Please register your identity first using the .register-id command.'
    );

    const mockCtxUnreg: any = {
        sock: { user: { id: 'bot_id' } },
        msg: { key: { participant: testJidClean, remoteJid: testJidClean } },
        jid: testJidClean
    };
    const loanReject = await loanTool.execute({ amount: '5000000' }, mockCtxUnreg);
    assert.strictEqual(loanReject, authBefore.message);

    const licenseReject = await applyLicenseTool.execute({}, mockCtxUnreg);
    assert.strictEqual(licenseReject, authBefore.message);

    const jobReject = await jobTool.execute({ action: 'join', job_name: 'Developer' }, mockCtxUnreg);
    assert.strictEqual(jobReject, authBefore.message);
    console.log('✓ Scenario D (Graceful Rejection) verified successfully.');

    // 4. Test Image Generation & Compositing with dynamic font scaling
    console.log('[Test 4] Testing Sharp image generation and long-text scaling...');
    const placeholderBuffer = await createPlaceholderPhotoBuffer();
    assert(placeholderBuffer.length > 0, 'Placeholder photo buffer must be valid');

    const sampleData = {
        nik: maleNik,
        fullName: 'RADEN MAS PANJI SUTISNA KUSUMAWARDHANA THE THIRD',
        placeOfBirth: 'KOTA ADMINISTRASI JAKARTA PUSAT',
        dateOfBirth: '17-08-1990',
        gender: 'LAKI-LAKI',
        address: 'JL. JENDERAL SUDIRMAN KAV. 52-53, RT.05/RW.03, KEL. SENAYAN',
        religion: 'ISLAM',
        maritalStatus: 'BELUM KAWIN',
        occupation: 'CHIEF TECHNOLOGY OFFICER',
        citizenship: 'WNI',
        validUntil: 'SEUMUR HIDUP'
    };

    const imageBuffer = await generateIdCardImage(sampleData, placeholderBuffer);
    assert(imageBuffer.length > 10000, 'Image buffer must be non-trivial size');

    const metadata = await sharp(imageBuffer).metadata();
    assert.strictEqual(metadata.width, 1264, 'Output width should match template');
    assert.strictEqual(metadata.height, 848, 'Output height should match template');
    assert.strictEqual(metadata.format, 'jpeg', 'Output format should be JPEG');
    console.log('✓ Image generation and Sharp compositing verified successfully.');

    // 5. Test Database Persistence
    console.log('[Test 5] Testing Prisma database persistence and user association...');
    const savedCard = await saveIdCard({
        userJid: testJidClean,
        fullName: 'Budi Santoso',
        placeOfBirth: 'Jakarta',
        dateOfBirth: '17-08-1990',
        gender: 'Laki-laki',
        address: 'Jl. Merdeka No. 1',
        religion: 'Islam',
        maritalStatus: 'Belum Kawin',
        occupation: 'Developer'
    });

    assert.strictEqual(cleanId(savedCard.userJid), testJidClean);
    assert.strictEqual(savedCard.fullName, 'BUDI SANTOSO');
    assert.strictEqual(savedCard.citizenship, 'WNI');
    assert.strictEqual(savedCard.validUntil, 'SEUMUR HIDUP');

    const fetchedByClean = await getIdCardByUser(testJidClean);
    assert.strictEqual(fetchedByClean?.nik, savedCard.nik);

    const fetchedByJid = await getIdCardByUser(`${testJidClean}@s.whatsapp.net`);
    assert.strictEqual(fetchedByJid?.nik, savedCard.nik, 'Must retrieve ID card using full JID');
    console.log('✓ Database persistence verified successfully.');

    // 6. Test Future Integration Scenarios with registered ID card
    console.log('[Test 6] Testing Scenarios A, B, C with registered user...');
    // Scenario A: Loan
    const loanApprove = await loanTool.execute({ amount: '5000000' }, mockCtxUnreg);
    assert(
        typeof loanApprove === 'string' && loanApprove.includes('Identity verification successful'),
        'Loan should be approved for registered user'
    );
    assert(
        typeof loanApprove === 'string' && loanApprove.includes(savedCard.nik),
        'Loan approval should mention user NIK'
    );
    assert(
        typeof loanApprove === 'string' && loanApprove.includes('Rp5.000.000'),
        'Loan approval should format amount as Rp5.000.000'
    );

    // Scenario B: License (Adult >= 17)
    const licenseApprove = await applyLicenseTool.execute({ licenseType: 'C' }, mockCtxUnreg);
    assert(
        typeof licenseApprove === 'string' && licenseApprove.includes('Identity verified!'),
        'License application should be verified'
    );
    assert(
        typeof licenseApprove === 'string' && licenseApprove.includes('BUDI SANTOSO'),
        'License application should include full name'
    );
    assert(
        typeof licenseApprove === 'string' && licenseApprove.includes('SIM C'),
        'License application should include requested category'
    );

    // Scenario C: Job
    const jobEmptyRole = await jobTool.execute({ action: 'join', target: '' }, mockCtxUnreg);
    assert(
        typeof jobEmptyRole === 'string' && jobEmptyRole.includes('Please specify a job name or ID'),
        'Empty role should be rejected'
    );
    const jobApprove = await jobTool.execute({ action: 'join', target: 'Office Work' }, mockCtxUnreg);
    assert(
        typeof jobApprove === 'string' && jobApprove.includes('Office Work'),
        'Job application should succeed for registered user'
    );
    console.log('✓ Scenarios A, B, C verified successfully.');

    // 7. Test Interactive Registration Flow & Session Management with Chat Isolation
    console.log('[Test 7] Testing interactive registration session flow and chat isolation...');
    const regUser = `interactive_user_${Date.now()}`;
    const chatJidA = 'group_chat_a@g.us';
    const chatJidB = 'group_chat_b@g.us';

    assert.strictEqual(isUserRegistering(regUser), false);

    const welcome = startRegistrationSession(regUser, chatJidA);
    assert(welcome.includes('Welcome to the Cosmos Identity System'));
    assert.strictEqual(isUserRegistering(regUser, chatJidA), true);
    assert.strictEqual(isUserRegistering(regUser, chatJidB), false, 'Session must not be active in chat B');

    const mockSock: any = {
        sentMessages: [] as any[],
        sendMessage: async (jid: string, content: any) => {
            mockSock.sentMessages.push({ jid, content });
        }
    };
    const mockMsgA: any = { key: { id: 'msg_1', participant: regUser, remoteJid: chatJidA } };
    const mockMsgB: any = { key: { id: 'msg_2', participant: regUser, remoteJid: chatJidB } };

    // Chat B isolation check: message in chat B should be ignored
    const handledInB = await processRegistrationStep(mockSock, mockMsgB, regUser, chatJidB, 'Jane Doe');
    assert.strictEqual(handledInB, false, 'Message in wrong chat should not be handled as registration');

    // Step 1: Send name (reject short name, accept valid name)
    await processRegistrationStep(mockSock, mockMsgA, regUser, chatJidA, 'A');
    assert(mockSock.sentMessages.pop().content.text.includes('at least 2 characters'));

    await processRegistrationStep(mockSock, mockMsgA, regUser, chatJidA, 'Jane Doe');
    assert(mockSock.sentMessages.pop().content.text.includes('Place and Date of Birth'));

    // Step 2: Send DOB (reject invalid, accept text month format)
    await processRegistrationStep(mockSock, mockMsgA, regUser, chatJidA, 'Just Jakarta');
    assert(mockSock.sentMessages.pop().content.text.includes('Invalid format'));

    await processRegistrationStep(mockSock, mockMsgA, regUser, chatJidA, 'Surabaya, 20 November 2002');
    assert(mockSock.sentMessages.pop().content.text.includes('Gender'));

    // Step 3: Send Gender (reject invalid string, accept Female)
    await processRegistrationStep(mockSock, mockMsgA, regUser, chatJidA, 'banana');
    assert(mockSock.sentMessages.pop().content.text.includes('Please specify a valid gender'));

    await processRegistrationStep(mockSock, mockMsgA, regUser, chatJidA, 'Female');
    assert(mockSock.sentMessages.pop().content.text.includes('Address'));

    // Step 4: Send Address
    await processRegistrationStep(mockSock, mockMsgA, regUser, chatJidA, 'Jl. Pahlawan No. 45');
    assert(mockSock.sentMessages.pop().content.text.includes('Religion'));

    // Step 5: Send Religion
    await processRegistrationStep(mockSock, mockMsgA, regUser, chatJidA, 'Kristen');
    assert(mockSock.sentMessages.pop().content.text.includes('Marital Status'));

    // Step 6: Send Marital Status
    await processRegistrationStep(mockSock, mockMsgA, regUser, chatJidA, 'Single');
    assert(mockSock.sentMessages.pop().content.text.includes('Occupation'));

    // Step 7: Send Occupation (Triggers card generation)
    await processRegistrationStep(mockSock, mockMsgA, regUser, chatJidA, 'UI Designer');
    assert.strictEqual(isUserRegistering(regUser), false, 'Registration session should be closed after completion');

    // Check that card was delivered as image
    const finalSent = mockSock.sentMessages.pop();
    assert(finalSent.content.image, 'Bot should have sent the final KTP image');
    assert(finalSent.content.caption.includes('Your Virtual ID Card has been successfully issued!'));
    assert(finalSent.content.caption.includes('JANE DOE'));

    // Check cancellation
    const cancelUser = `cancel_user_${Date.now()}`;
    startRegistrationSession(cancelUser, chatJidA);
    assert.strictEqual(isUserRegistering(cancelUser, chatJidA), true);
    await processRegistrationStep(mockSock, mockMsgA, cancelUser, chatJidA, '.cancel');
    assert.strictEqual(isUserRegistering(cancelUser, chatJidA), false);
    assert(mockSock.sentMessages.pop().content.text.includes('cancelled'));

    // Duplicate registration check
    const dupCtx: any = {
        sock: mockSock,
        msg: {
            message: { conversation: '.register-id' },
            key: { participant: testJidClean, remoteJid: testJidClean }
        },
        jid: testJidClean
    };
    await idCardTool.execute({}, dupCtx);
    const dupResponse = mockSock.sentMessages.find((m: any) =>
        m.content.text?.includes('Duplicate registrations are not permitted')
    );
    assert(dupResponse, 'Should reject duplicate registration');

    // 8. Test Baileys LID Compatibility Mentions
    console.log('[Test 8] Testing Baileys JID/LID formatMentions compliance...');
    const phoneJid = '628123456789';
    const lidUser = '120363041234567890';
    const mentions = formatMentions([phoneJid, lidUser]);
    assert.strictEqual(mentions.length, 2, 'formatMentions must contain exactly 1 entry per input ID');
    assert.strictEqual(mentions[0], '628123456789@s.whatsapp.net', 'Phone JID must map to @s.whatsapp.net');
    assert.strictEqual(mentions[1], '120363041234567890@lid', 'LID must map to @lid');
    console.log('✓ Baileys LID mentions verified successfully.');

    // Cleanup test data from DB
    await prisma.idCard.deleteMany({
        where: {
            userJid: { in: [testJidClean, regUser, `${testJidClean}@s.whatsapp.net`, `${regUser}@s.whatsapp.net`] }
        }
    });
    await prisma.user.deleteMany({
        where: {
            id: {
                in: [
                    testJidClean,
                    regUser,
                    cancelUser,
                    `${testJidClean}@s.whatsapp.net`,
                    `${regUser}@s.whatsapp.net`,
                    `${cancelUser}@s.whatsapp.net`
                ]
            }
        }
    });

    console.log('--- ALL TESTS PASSED SUCCESSFULLY! ---');
}

runTests()
    .catch((err) => {
        console.error('Test failed with error:', err);
        process.exit(1);
    })
    .finally(() => {
        process.exit(0);
    });
