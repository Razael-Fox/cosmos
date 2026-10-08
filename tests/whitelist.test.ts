import assert from 'node:assert';
import { prisma } from '../src/db.js';
import {
    isAutoWhitelistEnabled,
    setAutoWhitelist,
    getSystemConfig,
    clearSystemConfigCache
} from '../src/services/systemConfigService.js';
import { isGroupWhitelisted, addGroup, removeGroup, getAllWhitelistedGroups } from '../src/db.js';
import { execute as executeWhitelist } from '../src/commands/system-help/whitelist.js';
import type { ToolContext } from '../src/commands/types.js';
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { getTranslator } from '../src/utils/i18n.js';

// Owner authorization reads OWNER_PHONE_NUMBER from the environment, so pin it
// to the fixture below instead of depending on the local .env.
process.env.OWNER_PHONE_NUMBER = '6281200000101';

async function runTests() {
    console.log('--- STARTING GROUP WHITELIST SUITE TEST ---');

    const t = getTranslator('en');
    const ownerNumber = '6281200000101@s.whatsapp.net';
    const nonOwnerNumber = '628111111111@s.whatsapp.net';

    // =========================================================================
    // 1. System Config Service & Persistence
    // =========================================================================
    console.log('[Test 1] Testing SystemConfigService persistence and toggling...');
    clearSystemConfigCache();

    setAutoWhitelist(false);
    assert.strictEqual(isAutoWhitelistEnabled(), false, 'Auto-whitelist should initially be false');
    assert.strictEqual(getSystemConfig().autoWhitelistOnJoin, false);

    setAutoWhitelist(true);
    assert.strictEqual(isAutoWhitelistEnabled(), true, 'Auto-whitelist should be true after enable');
    assert.strictEqual(getSystemConfig().autoWhitelistOnJoin, true);

    setAutoWhitelist(false);
    assert.strictEqual(isAutoWhitelistEnabled(), false, 'Auto-whitelist should be false after disable');
    console.log('  ✔ SystemConfigService toggling and persistence passed.');

    // =========================================================================
    // 2. isGroupWhitelisted with Auto-Whitelist Gate
    // =========================================================================
    console.log('[Test 2] Testing isGroupWhitelisted auto-activity gate...');
    const testGroupA = '120363999001@g.us';
    const testGroupB = '120363999002@g.us';

    // Ensure groups are not currently in database
    await removeGroup(testGroupA);
    await removeGroup(testGroupB);

    // Auto-whitelist OFF: testGroupA should return false and not be added
    setAutoWhitelist(false);
    const wlCheckOff = await isGroupWhitelisted(testGroupA);
    assert.strictEqual(wlCheckOff, false, 'Unwhitelisted group should return false when auto-whitelist is off');
    const dbCheckOff = await prisma.whitelistedGroup.findUnique({ where: { jid: testGroupA } });
    assert.strictEqual(dbCheckOff, null, 'Group should not be in DB when auto-whitelist is off');

    // Auto-whitelist ON: testGroupB should return true and be auto-inserted
    setAutoWhitelist(true);
    const wlCheckOn = await isGroupWhitelisted(testGroupB);
    assert.strictEqual(wlCheckOn, true, 'Unwhitelisted group should return true when auto-whitelist is on');
    const dbCheckOn = await prisma.whitelistedGroup.findUnique({ where: { jid: testGroupB } });
    assert(dbCheckOn !== null, 'Group should be auto-inserted into DB when auto-whitelist is on');

    // Clean up
    await removeGroup(testGroupB);
    setAutoWhitelist(false);
    console.log('  ✔ Auto-activity gate for isGroupWhitelisted passed.');

    // =========================================================================
    // 3. Mock Sockets & Message Context Setup
    // =========================================================================
    console.log('[Test 3] Setting up mock WASocket and participating groups...');
    const mockGroups: Record<string, unknown> = {
        '120363111001@g.us': {
            id: '120363111001@g.us',
            subject: 'Cosmos Developers',
            participants: [{ id: ownerNumber }, { id: nonOwnerNumber }]
        },
        '120363111002@g.us': {
            id: '120363111002@g.us',
            subject: 'Community Hub',
            participants: [{ id: nonOwnerNumber }]
        },
        '120363111003@g.us': {
            id: '120363111003@g.us',
            subject: 'Trading VIP',
            participants: [{ id: ownerNumber }]
        }
    };

    // Clean up any existing DB entries for test groups
    for (const gid of Object.keys(mockGroups)) {
        await removeGroup(gid);
    }

    // Pre-whitelist only group 1
    await addGroup('120363111001@g.us', null);

    const sentMessages: Array<{ destJid: string; text: string }> = [];
    const mockSock = {
        user: { id: '6281200000202:1@s.whatsapp.net', name: 'CosmosBot' },
        sendMessage: async (dest: string, payload: { text: string }) => {
            sentMessages.push({ destJid: dest, text: payload.text });
            return { key: { id: `mock_msg_${Date.now()}` } };
        },
        groupFetchAllParticipating: async () => mockGroups
    } as unknown as WASocket;

    const makeMsg = (sender: string, text: string): WAMessage => {
        return {
            key: { remoteJid: '120363111001@g.us', participant: sender, fromMe: false },
            pushName: 'Tester',
            message: {
                conversation: text
            }
        } as unknown as WAMessage;
    };

    // =========================================================================
    // 4. Subcommand: .listgroup / .groups
    // =========================================================================
    console.log('[Test 4] Testing .listgroup catalog rendering...');
    sentMessages.length = 0;

    const listCtx: ToolContext = {
        sock: mockSock,
        msg: makeMsg(ownerNumber, '.listgroup'),
        jid: '120363111001@g.us',
        t
    };

    await executeWhitelist({ subcommand: 'list' }, listCtx);
    assert.strictEqual(sentMessages.length, 1, 'Should send one message with catalog');
    const listOutput = sentMessages[0].text;
    assert(listOutput.includes('Available WhatsApp Groups'), 'Output should contain title');
    assert(listOutput.includes('Cosmos Developers'), 'Output should contain group 1 name');
    assert(listOutput.includes('Community Hub'), 'Output should contain group 2 name');
    assert(listOutput.includes('Trading VIP'), 'Output should contain group 3 name');
    assert(listOutput.includes('WHITELISTED'), 'Group 1 should be marked WHITELISTED');
    assert(listOutput.includes('NOT WHITELISTED'), 'Group 2 and 3 should be marked NOT WHITELISTED');
    assert(listOutput.includes('Total: 3 groups'), 'Summary should mention total count');
    console.log('  ✔ .listgroup catalog rendering passed.');

    // =========================================================================
    // 5. Subcommand: .whitelistall Batch Execution & Permissions
    // =========================================================================
    console.log('[Test 5] Testing .whitelistall batch execution & authorization...');
    sentMessages.length = 0;

    // Non-owner should be unauthorized
    const unauthorizedCtx: ToolContext = {
        sock: mockSock,
        msg: makeMsg(nonOwnerNumber, '.whitelistall'),
        jid: '120363111001@g.us',
        t
    };
    await executeWhitelist({ subcommand: 'all' }, unauthorizedCtx);
    assert.strictEqual(sentMessages.length, 1);
    assert(sentMessages[0].text.includes('not authorized') || sentMessages[0].text.includes('unauthorized'));

    // Owner executes .whitelistall
    sentMessages.length = 0;
    const ownerBatchCtx: ToolContext = {
        sock: mockSock,
        msg: makeMsg(ownerNumber, '.whitelistall'),
        jid: '120363111001@g.us',
        t
    };
    await executeWhitelist({ subcommand: 'all' }, ownerBatchCtx);
    assert.strictEqual(sentMessages.length, 1);
    const batchOutput = sentMessages[0].text;
    assert(batchOutput.includes('Batch Whitelist Complete') || batchOutput.includes('Successfully whitelisted'));
    assert(batchOutput.includes('2'), 'Should add 2 previously unwhitelisted groups');

    // Verify all 3 groups are now in database
    const allGroupsInDb = await getAllWhitelistedGroups();
    assert(allGroupsInDb.includes('120363111001@g.us'));
    assert(allGroupsInDb.includes('120363111002@g.us'));
    assert(allGroupsInDb.includes('120363111003@g.us'));

    // Second execution: all groups already whitelisted
    sentMessages.length = 0;
    await executeWhitelist({ subcommand: 'all' }, ownerBatchCtx);
    assert.strictEqual(sentMessages.length, 1);
    assert(sentMessages[0].text.includes('already whitelisted'));
    console.log('  ✔ .whitelistall batch execution and idempotency passed.');

    // =========================================================================
    // 6. Subcommand: .whitelist auto on | off
    // =========================================================================
    console.log('[Test 6] Testing .whitelist auto on/off...');
    sentMessages.length = 0;

    const autoOnCtx: ToolContext = {
        sock: mockSock,
        msg: makeMsg(ownerNumber, '.whitelist auto on'),
        jid: '120363111001@g.us',
        t
    };
    await executeWhitelist({ subcommand: 'auto', target: 'on' }, autoOnCtx);
    assert.strictEqual(isAutoWhitelistEnabled(), true, 'Auto whitelist should be set to true');
    assert(sentMessages[0].text.includes('ENABLED'));

    sentMessages.length = 0;
    const autoOffCtx: ToolContext = {
        sock: mockSock,
        msg: makeMsg(ownerNumber, '.whitelist auto off'),
        jid: '120363111001@g.us',
        t
    };
    await executeWhitelist({ subcommand: 'auto', target: 'off' }, autoOffCtx);
    assert.strictEqual(isAutoWhitelistEnabled(), false, 'Auto whitelist should be set to false');
    assert(sentMessages[0].text.includes('DISABLED'));
    console.log('  ✔ .whitelist auto on/off passed.');

    // =========================================================================
    // 7. Subcommand: .whitelist status (Dashboard)
    // =========================================================================
    console.log('[Test 7] Testing .whitelist status dashboard...');
    sentMessages.length = 0;

    const statusCtx: ToolContext = {
        sock: mockSock,
        msg: makeMsg(ownerNumber, '.whitelist status'),
        jid: '120363111001@g.us',
        t
    };
    await executeWhitelist({ subcommand: 'status' }, statusCtx);
    assert.strictEqual(sentMessages.length, 1);
    const statusOutput = sentMessages[0].text;
    assert(statusOutput.includes('Group Whitelist Suite'));
    assert(statusOutput.includes('Participating Groups'));
    assert(statusOutput.includes('Whitelisted Groups'));
    assert(statusOutput.includes('Auto-Whitelist on Join'));
    assert(statusOutput.includes('.listgroup'));
    assert(statusOutput.includes('.whitelistall'));
    console.log('  ✔ .whitelist status dashboard passed.');

    // =========================================================================
    // 8. Two-word aliases through the handler-resolved envelope
    // =========================================================================
    // Regression guard: `whitelist all` and `group list` are two-word aliases, so
    // the registry resolves them into a single canonical key containing a space.
    // A tool that inserts that key into its token array unsplit ends up with
    // tokens ["whitelist all"] and no subcommand, and silently sends nothing.
    // Every earlier case in this suite omits commandName/argsStr and therefore
    // exercises only the raw-text fallback, which is exactly why that regression
    // stayed invisible. These cases populate the envelope the handler supplies.
    console.log('[Test 8] Testing two-word aliases via the resolved command envelope...');

    const envelopeCases: Array<{
        commandName: string;
        argsStr: string;
        label: string;
        expect: (text: string) => boolean;
    }> = [
        {
            commandName: '.whitelist all',
            argsStr: '',
            label: '.whitelist all',
            // Two-word alias: must map to the batch subcommand, not the dashboard.
            // The batch wording differs depending on how many groups are still
            // unwitelisted ("Batch Whitelist Complete" vs "Batch Whitelist
            // Status"), so match the family and reject the dashboard explicitly.
            expect: (text) => text.includes('Batch Whitelist') && !text.includes('Group Whitelist Suite')
        },
        {
            commandName: '.group list',
            argsStr: '',
            label: '.group list',
            expect: (text) => text.includes('Total: 3 groups')
        },
        {
            commandName: '.whitelist list',
            argsStr: '',
            label: '.whitelist list',
            expect: (text) => text.includes('Total: 3 groups')
        },
        {
            commandName: '.whitelistall',
            argsStr: '',
            label: '.whitelistall',
            expect: (text) => text.includes('Batch Whitelist') && !text.includes('Group Whitelist Suite')
        },
        {
            commandName: '.listgroup',
            argsStr: '',
            label: '.listgroup',
            expect: (text) => text.includes('Total: 3 groups')
        },
        {
            commandName: '.whitelist status',
            argsStr: '',
            label: '.whitelist status',
            expect: (text) => text.includes('Group Whitelist Suite')
        }
    ];

    for (const testCase of envelopeCases) {
        sentMessages.length = 0;
        const envelopeCtx: ToolContext = {
            sock: mockSock,
            msg: makeMsg(ownerNumber, `${testCase.commandName}${testCase.argsStr ? ` ${testCase.argsStr}` : ''}`),
            jid: '120363111001@g.us',
            t,
            commandName: testCase.commandName,
            argsStr: testCase.argsStr
        };
        await executeWhitelist({}, envelopeCtx);
        assert.strictEqual(sentMessages.length, 1, `${testCase.label} must reply exactly once`);
        assert.ok(
            testCase.expect(sentMessages[0].text),
            `${testCase.label} must resolve to its own subcommand. An unsplit command key yields an empty subcommand, which falls through to the status dashboard instead.`
        );
    }
    console.log('  ✔ Two-word alias envelope resolution passed.');

    // =========================================================================
    // 9. Separator variants of the list/all aliases
    // =========================================================================
    // The registry's last-resort stripped index matches `.list-group` and
    // `.list_group` by ignoring separators, so those spellings reach the tool as
    // ['list', 'group'] — first word only. Mapping on tokens[0] therefore missed
    // the `listgroup` alias and fell through to the dashboard. Mapping on the
    // stripped command key collapses every separator variant onto one
    // comparison.
    console.log('[Test 9] Testing separator variants of the list/all aliases...');

    const separatorCases: Array<{ commandName: string; expect: (text: string) => boolean }> = [
        { commandName: '.listgroup', expect: (text) => text.includes('Total: 3 groups') },
        { commandName: '.list-group', expect: (text) => text.includes('Total: 3 groups') },
        { commandName: '.list_group', expect: (text) => text.includes('Total: 3 groups') },
        { commandName: '.grouplist', expect: (text) => text.includes('Total: 3 groups') },
        { commandName: '.group-list', expect: (text) => text.includes('Total: 3 groups') },
        { commandName: '.group_list', expect: (text) => text.includes('Total: 3 groups') },
        { commandName: '.groups', expect: (text) => text.includes('Total: 3 groups') },
        { commandName: '.whitelistall', expect: (text) => text.includes('Batch Whitelist') },
        { commandName: '.whitelist-all', expect: (text) => text.includes('Batch Whitelist') },
        { commandName: '.whitelist_all', expect: (text) => text.includes('Batch Whitelist') },
        { commandName: '.addallgroups', expect: (text) => text.includes('Batch Whitelist') }
    ];

    for (const testCase of separatorCases) {
        sentMessages.length = 0;
        const separatorCtx: ToolContext = {
            sock: mockSock,
            msg: makeMsg(ownerNumber, testCase.commandName),
            jid: '120363111001@g.us',
            t,
            commandName: testCase.commandName,
            argsStr: ''
        };
        await executeWhitelist({}, separatorCtx);
        assert.strictEqual(sentMessages.length, 1, `${testCase.commandName} must reply exactly once`);
        assert.ok(
            testCase.expect(sentMessages[0].text),
            `${testCase.commandName} must route to its own subcommand, not the dashboard. Separator variants reach the tool with the first word only, so the alias must be matched on the stripped command key.`
        );
    }
    console.log('  ✔ Separator variant routing passed.');

    // Teardown test groups
    for (const gid of Object.keys(mockGroups)) {
        await removeGroup(gid);
    }

    console.log('\n======================================================');
    console.log('🎉 ALL GROUP WHITELIST SUITE TESTS PASSED! 🎉');
    console.log('======================================================\n');
}

runTests().catch((err) => {
    console.error('❌ Test failure in whitelist.test.ts:', err);
    process.exit(1);
});
