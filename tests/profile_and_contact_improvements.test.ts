import assert from 'assert';
import fs from 'fs';
import toolsHandler from '../src/tools/handler.js';
import { prisma } from '../src/db.js';
import { getLegacyCanonical } from '../src/utils/commandFormat.js';
import {
    validateContactNameWithAI,
    validatePhoneNumber,
    createEncryptedContactBackup,
    restoreEncryptedContactBackup
} from '../src/services/contactService.js';
import { execute as executeMyPlan } from '../src/tools/myplan.js';
import { execute as executeQuota } from '../src/tools/quota.js';
import { execute as executeProfile } from '../src/tools/profile.js';
import contactTool from '../src/tools/contact.js';
import type { ToolContext } from '../src/tools/types.js';
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';

async function runTestSuite() {
    console.log('--- STARTING USER PROFILE, SEPARATION & CONTACT IMPROVEMENTS TESTS ---');

    await toolsHandler.loadTools();

    // =========================================================================
    // 1. Separation of Commands (.add balance, .top global, .fever time)
    // =========================================================================
    console.log('[Test 1] Testing separation of .add balance, .top global, .fever time...');

    const addBalanceTool = toolsHandler.getTool('.add balance');
    assert(addBalanceTool, '.add balance must be resolvable via toolsHandler');
    assert.strictEqual(addBalanceTool.definition.name, 'addbalance');
    assert.strictEqual(toolsHandler.getTool('add balance')?.definition.name, 'addbalance');
    assert.strictEqual(toolsHandler.getTool('.addbalance')?.definition.name, 'addbalance');

    const topGlobalTool = toolsHandler.getTool('.top global');
    assert(topGlobalTool, '.top global must be resolvable via toolsHandler');
    assert.strictEqual(topGlobalTool.definition.name, 'topglobal');
    assert.strictEqual(toolsHandler.getTool('top global')?.definition.name, 'topglobal');
    assert.strictEqual(toolsHandler.getTool('.topglobal')?.definition.name, 'topglobal');

    const feverTimeTool = toolsHandler.getTool('.fever time');
    assert(feverTimeTool, '.fever time must be resolvable via toolsHandler');
    assert.strictEqual(feverTimeTool.definition.name, 'fevertime');
    assert.strictEqual(toolsHandler.getTool('fever time')?.definition.name, 'fevertime');
    assert.strictEqual(toolsHandler.getTool('.fevertime')?.definition.name, 'fevertime');

    // Legacy deprecation canonical resolution
    assert.strictEqual(getLegacyCanonical('addbalance'), '.add balance');
    assert.strictEqual(getLegacyCanonical('topglobal'), '.top global');
    assert.strictEqual(getLegacyCanonical('fevertime'), '.fever time');

    console.log('✓ Command separation verified.');
    // =========================================================================
    // 1b. Execution of addbalance (.add balance @user 50)
    // =========================================================================
    console.log('[Test 1b] Testing execution of addbalance with mention & proper formatting...');
    const targetUserJid = '6285136533136@s.whatsapp.net';
    await prisma.user.upsert({
        where: { id: targetUserJid },
        create: { id: targetUserJid, pushName: 'Zhopi', balance: BigInt(0) },
        update: {}
    });

    const addBalanceSentMessages: Array<{ dest: string; content: any }> = [];
    const addBalanceSock = {
        user: { id: '628123456789:1@s.whatsapp.net' },
        sendMessage: async (dest: string, content: any) => {
            addBalanceSentMessages.push({ dest, content });
            return { key: { id: 'mock-id' } };
        }
    };

    const addBalanceMsg = {
        key: { remoteJid: '120363274823554999@g.us', participant: '628123456789@s.whatsapp.net', fromMe: false },
        message: {
            extendedTextMessage: {
                text: '.tambah saldo @6285136533136 50',
                contextInfo: {
                    mentionedJid: [targetUserJid]
                }
            }
        }
    };

    const { getTranslator } = await import('../src/utils/i18n.js');
    const tId = getTranslator('id');
    const addBalanceCtx: ToolContext = {
        msg: addBalanceMsg as any,
        sock: addBalanceSock as any,
        jid: '120363274823554999@g.us',
        t: tId,
        lang: 'id',
        usedPrefix: '.'
    };

    await addBalanceTool.execute({ input: '@6285136533136 50' }, addBalanceCtx);
    assert(addBalanceSentMessages.length > 0, 'addbalance must send a confirmation message');
    assert(
        !addBalanceSentMessages[0].content.text.includes('{{user}}'),
        'Message text must NOT contain unrendered {{user}}'
    );
    assert(
        !addBalanceSentMessages[0].content.text.includes('{{target}}'),
        'Message text must NOT contain unrendered {{target}}'
    );
    assert(
        addBalanceSentMessages[0].content.text.includes('@6285136533136'),
        'Message text must include @6285136533136'
    );
    assert(addBalanceSentMessages[0].content.text.includes('Rp50'), 'Message text must include Rp50');
    assert.deepStrictEqual(
        addBalanceSentMessages[0].content.mentions,
        ['6285136533136@s.whatsapp.net'],
        'mentions array must be formatted properly'
    );
    console.log('✓ addbalance execution verified.');

    // =========================================================================
    // 2. Profile Commands (.my plan, .my quota, .my profile, .check plan, .check quota)
    // =========================================================================
    console.log('[Test 2] Testing profile commands separation and resolution...');

    // .my plan & .check plan
    assert.strictEqual(toolsHandler.getTool('.my plan')?.definition.name, 'myplan');
    assert.strictEqual(toolsHandler.getTool('my plan')?.definition.name, 'myplan');
    assert.strictEqual(toolsHandler.getTool('.check plan')?.definition.name, 'myplan');
    assert.strictEqual(toolsHandler.getTool('check plan')?.definition.name, 'myplan');
    assert.strictEqual(toolsHandler.getTool('.plan')?.definition.name, 'myplan');
    assert.strictEqual(toolsHandler.getTool('.myplan')?.definition.name, 'myplan');

    // .my quota & .check quota
    assert.strictEqual(toolsHandler.getTool('.my quota')?.definition.name, 'quota');
    assert.strictEqual(toolsHandler.getTool('my quota')?.definition.name, 'quota');
    assert.strictEqual(toolsHandler.getTool('.check quota')?.definition.name, 'quota');
    assert.strictEqual(toolsHandler.getTool('check quota')?.definition.name, 'quota');
    assert.strictEqual(toolsHandler.getTool('.quota')?.definition.name, 'quota');
    assert.strictEqual(toolsHandler.getTool('.myquota')?.definition.name, 'quota');

    // .my profile & .profile
    assert.strictEqual(toolsHandler.getTool('.my profile')?.definition.name, 'profile');
    assert.strictEqual(toolsHandler.getTool('my profile')?.definition.name, 'profile');
    assert.strictEqual(toolsHandler.getTool('.profile')?.definition.name, 'profile');
    assert.strictEqual(toolsHandler.getTool('.myprofile')?.definition.name, 'profile');

    // Legacy deprecation canonical resolution
    assert.strictEqual(getLegacyCanonical('myplan'), '.my plan');
    assert.strictEqual(getLegacyCanonical('checkplan'), '.check plan');
    assert.strictEqual(getLegacyCanonical('myquota'), '.my quota');
    assert.strictEqual(getLegacyCanonical('checkquota'), '.check quota');
    assert.strictEqual(getLegacyCanonical('myprofile'), '.my profile');

    console.log('✓ Profile command separation verified.');

    // =========================================================================
    // 3. Execution of Profile Commands (Smoke Test)
    // =========================================================================
    console.log('[Test 3] Testing execution of .my plan, .my quota, and .my profile...');

    const testUserJid = '6289988776655@s.whatsapp.net';
    await prisma.user.upsert({
        where: { id: testUserJid },
        create: {
            id: testUserJid,
            pushName: 'Cosmos Tester',
            balance: BigInt(50000),
            creditScore: 720
        },
        update: {
            pushName: 'Cosmos Tester',
            balance: BigInt(50000),
            creditScore: 720
        }
    });

    let sentMessages: Array<{ dest: string; content: any }> = [];
    const mockSock = {
        user: { id: '6285136533136:1@s.whatsapp.net' },
        sendMessage: async (dest: string, content: any) => {
            sentMessages.push({ dest, content });
            return { key: { id: 'mock-id' } };
        }
    };

    const mockMsg = {
        key: { remoteJid: testUserJid, participant: testUserJid, fromMe: false },
        message: { conversation: '' },
        pushName: 'Cosmos Tester'
    };

    const ctx: ToolContext = {
        sock: mockSock as unknown as WASocket,
        msg: mockMsg as unknown as WAMessage,
        jid: testUserJid,
        t: (k: string, v?: any) => {
            if (k === 'tools.myplan.title') return '📊 *Cosmos Subscription & Limits*';
            if (k === 'tools.myplan.user_label') return 'User';
            if (k === 'tools.myplan.plan_label') return 'Plan';
            if (k === 'tools.myplan.status_label') return 'Status';
            if (k === 'tools.myplan.tier_free') return 'Pulse (Free)';
            if (k === 'tools.myplan.status_active') return 'Active';
            if (k === 'tools.myplan.custom_prefix_label') return 'Custom Prefix';
            if (k === 'tools.myplan.prefix_locked') return 'Locked (.)';
            if (k === 'tools.myplan.economy_bonus_label') return 'Economy Bonus';
            if (k === 'tools.myplan.multiplier_suffix') return 'x Multiplier';
            if (k === 'tools.myplan.upgrade_cta') return 'Upgrade at https://razael-fox.my.id/pricing';
            if (k === 'tools.myplan.example_cost') return `Example: ${v?.cost || '10k'}`;
            if (k === 'tools.myplan.quota_tip') return 'Use .my quota or .check quota to view resource limits.';
            if (k === 'tools.quota.title') return '📊 *Cosmos Resource Quota Usage*';
            if (k === 'tools.myplan.groups_label') return 'Whitelisted Groups';
            if (k === 'tools.myplan.subbots_label') return 'Active Sub-Bots';
            if (k === 'tools.myplan.used_suffix') return 'used';
            if (k === 'tools.quota.available_label') return 'Available';
            if (k === 'tools.quota.manage_tip') return 'Need more capacity?';
            if (k === 'tools.quota.plan_tip') return 'Use .my plan to view tier perks.';
            if (k === 'tools.profile.title') return 'COSMOS CITIZEN PROFILE';
            if (k === 'tools.profile.section_identity') return '📋 Identity & Citizenship';
            if (k === 'tools.profile.section_financial') return '💰 Financial Overview';
            if (k === 'tools.profile.section_stats') return '🎮 Activity & Records';
            return k;
        }
    };

    // Execute .my plan
    sentMessages = [];
    await executeMyPlan({}, ctx);
    assert(sentMessages.length > 0, '.my plan must send a message');
    assert(sentMessages[0].content.text.includes('Cosmos Subscription'), 'Must contain plan header');
    assert(sentMessages[0].content.text.includes('Pulse (Free)'), 'Must contain Free tier');

    // Execute .my quota
    sentMessages = [];
    await executeQuota({}, ctx);
    assert(sentMessages.length > 0, '.my quota must send a message');
    assert(sentMessages[0].content.text.includes('Cosmos Resource Quota Usage'), 'Must contain quota header');
    assert(sentMessages[0].content.text.includes('Whitelisted Groups'), 'Must show groups quota');

    // Execute .my profile
    sentMessages = [];
    await executeProfile({}, ctx);
    assert(sentMessages.length > 0, '.my profile must send a message');
    assert(sentMessages[0].content.text.includes('COSMOS CITIZEN PROFILE'), 'Must contain citizen profile header');
    assert(sentMessages[0].content.text.includes('Identity & Citizenship'), 'Must contain identity section');
    assert(sentMessages[0].content.text.includes('Financial Overview'), 'Must contain financial section');

    console.log('✓ Profile execution verified.');

    // =========================================================================
    // 4. Contact Validation & Real-Time Filtering
    // =========================================================================
    console.log('[Test 4] Testing contact name and phone validation...');

    // A. Reserved keyword validation
    const reservedCheck = await validateContactNameWithAI('backup');
    assert(!reservedCheck.isValid, 'Reserved keyword "backup" must be rejected');
    assert(reservedCheck.reason.includes('reserved'), 'Reason must state reserved keyword');

    // B. Gibberish / symbol validation
    const symbolCheck = await validateContactNameWithAI('???!!!');
    assert(!symbolCheck.isValid, 'Pure symbols must be rejected');

    // C. Misspelled detection & suggested correction
    const typoCheck = await validateContactNameWithAI('faather');
    assert(!typoCheck.isValid, 'Obvious typo "faather" must be rejected');
    assert.strictEqual(typoCheck.isMisspelled, true, 'isMisspelled must be true');
    assert.strictEqual(typoCheck.suggestedCorrection, 'Father', 'Must suggest "Father"');

    // D. Offensive word rejection
    const offensiveCheck = await validateContactNameWithAI('kontol');
    assert(!offensiveCheck.isValid, 'Offensive term must be rejected');
    assert(!offensiveCheck.isAppropriate, 'isAppropriate must be false');

    // E. Valid contact names
    const validCheck1 = await validateContactNameWithAI('Mom');
    assert(validCheck1.isValid, '"Mom" must be valid');

    const validCheck2 = await validateContactNameWithAI('Doctor Smith');
    assert(validCheck2.isValid, '"Doctor Smith" must be valid');

    // F. Phone number validation
    const validPhone = await validatePhoneNumber('+62 812-3456-7890');
    assert(validPhone.isValid, 'Formatted Indonesian number must be valid');
    assert.strictEqual(validPhone.canonicalJid, '6281234567890@s.whatsapp.net');

    const shortPhone = await validatePhoneNumber('12345');
    assert(!shortPhone.isValid, 'Short phone number must be rejected');

    const zerosPhone = await validatePhoneNumber('0000000000');
    assert(!zerosPhone.isValid, 'All-zero phone number must be rejected');

    console.log('✓ Contact name and phone validation verified.');

    // =========================================================================
    // 5. Encrypted Personal Contact File Backup & Restore
    // =========================================================================
    console.log('[Test 5] Testing encrypted contact backup and restore...');

    const backupUserJid = '62811122233344@s.whatsapp.net';
    await prisma.user.upsert({
        where: { id: backupUserJid },
        create: { id: backupUserJid, pushName: 'Backup Tester' },
        update: {}
    });

    // Clean previous contacts
    await prisma.userContactBook.deleteMany({ where: { ownerJid: backupUserJid } });

    // Add contacts using tool
    sentMessages = [];
    const contactMockMsg = {
        key: { remoteJid: backupUserJid, participant: backupUserJid, fromMe: false },
        message: { conversation: '' }
    };
    const contactCtx: ToolContext = {
        sock: mockSock as unknown as WASocket,
        msg: contactMockMsg as unknown as WAMessage,
        jid: backupUserJid,
        t: (k: string) => k
    };

    // Add Doctor Smith
    await contactTool.execute({ rawText: 'add `Doctor Smith` 6281234567891' }, contactCtx);
    // Add Mom
    await contactTool.execute({ rawText: 'add Mom 6281234567892' }, contactCtx);

    const initialContacts = await prisma.userContactBook.findMany({ where: { ownerJid: backupUserJid } });
    assert.strictEqual(initialContacts.length, 2, 'Should have 2 saved contacts');

    // Create encrypted backup
    const backupRes = await createEncryptedContactBackup(backupUserJid);
    assert(backupRes.success, 'Backup creation must succeed');
    assert.strictEqual(backupRes.contactCount, 2, 'Backup must contain 2 contacts');
    assert(backupRes.encryptedBuffer.length > 0, 'Encrypted buffer must be non-empty');
    assert(fs.existsSync(backupRes.filePath), 'Backup file must exist on disk');

    // Verify backup is encrypted and not plain JSON
    assert(!backupRes.encryptedBuffer.toString('utf8').includes('Doctor Smith'), 'Backup file must be encrypted');

    // Delete contacts to simulate data loss
    await prisma.userContactBook.deleteMany({ where: { ownerJid: backupUserJid } });
    const emptyCheck = await prisma.userContactBook.count({ where: { ownerJid: backupUserJid } });
    assert.strictEqual(emptyCheck, 0, 'Contacts must be cleared before restore');

    // Restore from encrypted backup buffer
    const restoreRes = await restoreEncryptedContactBackup(backupUserJid, backupRes.encryptedBuffer);
    assert(restoreRes.success, 'Backup restore must succeed');
    assert.strictEqual(restoreRes.restoredCount, 2, 'Must restore 2 contacts');

    const restoredContacts = await prisma.userContactBook.findMany({
        where: { ownerJid: backupUserJid },
        orderBy: { alias: 'asc' }
    });
    assert.strictEqual(restoredContacts.length, 2, 'Restored contacts count must be 2');
    assert.strictEqual(restoredContacts[0].alias, 'doctor smith');
    assert.strictEqual(restoredContacts[1].alias, 'mom');

    // Test tool integration for .contact backup and .contact restore
    sentMessages = [];
    await contactTool.execute({ rawText: 'backup' }, contactCtx);
    assert(sentMessages.length > 0, '.contact backup must send a document');
    assert(sentMessages[0].content.document, 'Message must contain a document buffer');
    assert(sentMessages[0].content.caption.includes('AES-256-GCM'), 'Caption must state AES-256-GCM');

    sentMessages = [];
    await contactTool.execute({ rawText: 'restore' }, contactCtx);
    assert(sentMessages.length > 0, '.contact restore must send confirmation');
    assert(sentMessages[0].content.text.includes('Restored Successfully'), 'Must confirm restore success');

    console.log('✓ Encrypted contact backup and restore verified.');

    console.log('--- ALL USER PROFILE, SEPARATION & CONTACT TESTS PASSED! ---');
}

runTestSuite().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
