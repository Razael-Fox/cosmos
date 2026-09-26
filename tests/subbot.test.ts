import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { getPrismaClient, disconnectPrismaClient, dbContext } from '../src/db.js';
import {
    loadConfig,
    updateFeature,
    setApiKey,
    setMode,
    setPrefix,
    isFeatureEnabled,
    clearConfigCache
} from '../src/services/subBotConfigService.js';
import { resolveApiKey, maskApiKey } from '../src/utils/apiKeyResolver.js';
import { requestPairing, broadcastSubBotForex, deleteSubBot } from '../src/services/subBotService.js';
import {
    hasCancellableSession,
    cancelActiveSession,
    clearAllCancellableSessions
} from '../src/utils/cancellationManager.js';
import * as subbotTool from '../src/tools/subbot.js';
import * as configTool from '../src/tools/config.js';
import { getTranslator } from '../src/utils/i18n.js';
import { activeConnections } from '../src/utils/connectionManager.js';

const TEST_SUBBOT_NUM = '628999900001';
const TEST_SUBBOT_NUM_2 = '628999900002';
const t = getTranslator('en');

async function runTests() {
    console.log('=== STARTING SUB-BOT MULTI-DEVICE TEST SUITE ===\n');

    // Clean up test directories if leftover
    for (const num of [TEST_SUBBOT_NUM, TEST_SUBBOT_NUM_2]) {
        const dir1 = path.resolve(process.cwd(), 'database', num);
        const dir2 = path.resolve(process.cwd(), 'storage', 'sub-bot', num);
        if (fs.existsSync(dir1)) fs.rmSync(dir1, { recursive: true, force: true });
        if (fs.existsSync(dir2)) fs.rmSync(dir2, { recursive: true, force: true });
        clearConfigCache(num);
    }
    clearAllCancellableSessions();

    try {
        // [Test 1] Isolated Per-Bot Database Storage
        console.log('[Test 1] Testing Isolated Database Storage...');
        const client1 = getPrismaClient(`sub_${TEST_SUBBOT_NUM}`);
        const dbPath1 = fs.existsSync(
            path.resolve(process.cwd(), 'storage', 'sub-bot', TEST_SUBBOT_NUM, 'database.sqlite')
        )
            ? path.resolve(process.cwd(), 'storage', 'sub-bot', TEST_SUBBOT_NUM, 'database.sqlite')
            : path.resolve(process.cwd(), 'database', TEST_SUBBOT_NUM, 'database.sqlite');
        assert(fs.existsSync(dbPath1), 'Sub-bot 1 SQLite file must exist');

        const client2 = getPrismaClient(`sub_${TEST_SUBBOT_NUM_2}`);
        const dbPath2 = fs.existsSync(
            path.resolve(process.cwd(), 'storage', 'sub-bot', TEST_SUBBOT_NUM_2, 'database.sqlite')
        )
            ? path.resolve(process.cwd(), 'storage', 'sub-bot', TEST_SUBBOT_NUM_2, 'database.sqlite')
            : path.resolve(process.cwd(), 'database', TEST_SUBBOT_NUM_2, 'database.sqlite');
        assert(fs.existsSync(dbPath2), 'Sub-bot 2 SQLite file must exist');

        // Verify data isolation: create a group in sub-bot 1 DB
        await client1.whitelistedGroup.upsert({
            where: { jid: 'group_test_1@g.us' },
            update: {},
            create: { jid: 'group_test_1@g.us' }
        });

        const inSub1 = await client1.whitelistedGroup.findUnique({ where: { jid: 'group_test_1@g.us' } });
        assert(inSub1, 'Group must exist in sub-bot 1 DB');

        const inSub2 = await client2.whitelistedGroup.findUnique({ where: { jid: 'group_test_1@g.us' } });
        assert.strictEqual(inSub2, null, 'Group in sub-bot 1 DB must NOT exist in sub-bot 2 DB');

        await disconnectPrismaClient(`sub_${TEST_SUBBOT_NUM}`);
        await disconnectPrismaClient(`sub_${TEST_SUBBOT_NUM_2}`);
        console.log('✓ Isolated database storage verified.\n');

        // [Test 2] Config File Persistence & Mutation
        console.log('[Test 2] Testing Sub-Bot Configuration Persistence...');
        const cfg = loadConfig(TEST_SUBBOT_NUM);
        assert.strictEqual(cfg.subBotNumber, TEST_SUBBOT_NUM);
        assert.strictEqual(cfg.mode, 'public');
        assert.strictEqual(cfg.features.casino, true);
        assert.strictEqual(cfg.features.forexAnnouncement, true);

        // Update feature
        updateFeature(TEST_SUBBOT_NUM, 'casino', false);
        assert.strictEqual(isFeatureEnabled(TEST_SUBBOT_NUM, 'casino'), false);

        // Clear in-memory cache and reload from disk to ensure persistence
        clearConfigCache(TEST_SUBBOT_NUM);
        const reloaded = loadConfig(TEST_SUBBOT_NUM);
        assert.strictEqual(reloaded.features.casino, false, 'Feature change must persist to disk');

        // Update mode and prefix
        setMode(TEST_SUBBOT_NUM, 'self');
        setPrefix(TEST_SUBBOT_NUM, '!');
        clearConfigCache(TEST_SUBBOT_NUM);
        const reloaded2 = loadConfig(TEST_SUBBOT_NUM);
        assert.strictEqual(reloaded2.mode, 'self');
        assert.strictEqual(reloaded2.prefix, '!');
        console.log('✓ Config file persistence verified.\n');

        // [Test 3] Hierarchical API Key Resolution & Masking
        console.log('[Test 3] Testing Hierarchical API Key Resolution...');
        const parentGroqKey = process.env.GROQ_API_KEY || 'parent_env_groq_key_default_123';
        process.env.GROQ_API_KEY = parentGroqKey;

        // With no custom key set, it resolves to parent key
        const resolvedDefault = resolveApiKey('groq', TEST_SUBBOT_NUM);
        assert.strictEqual(resolvedDefault, parentGroqKey, 'Should fall back to parent env key');

        // Set custom sub-bot key
        const customKey = 'gsk_customsubbotkey123456789xyz';
        setApiKey(TEST_SUBBOT_NUM, 'groq', customKey);
        clearConfigCache(TEST_SUBBOT_NUM);

        const resolvedCustom = resolveApiKey('groq', TEST_SUBBOT_NUM);
        assert.strictEqual(resolvedCustom, customKey, 'Custom sub-bot key must take precedence');

        // Masking test
        const masked = maskApiKey(customKey);
        assert.strictEqual(masked, 'gsk_••••••••9xyz');

        // Clear custom key and verify fallback
        setApiKey(TEST_SUBBOT_NUM, 'groq', null);
        clearConfigCache(TEST_SUBBOT_NUM);
        const resolvedAfterClear = resolveApiKey('groq', TEST_SUBBOT_NUM);
        assert.strictEqual(resolvedAfterClear, parentGroqKey, 'Must fall back to parent key after clearing');
        console.log('✓ Hierarchical API key resolution verified.\n');

        // [Test 4] Global Cancellation (.cancel) on Pairing Flow
        console.log('[Test 4] Testing Pairing Session & Global Cancellation...');
        const mockSock: any = {
            sendMessage: async () => ({ key: { id: 'mock_msg' } }),
            end: () => {}
        };
        const mockMsg: any = {
            key: { remoteJid: 'chat_test@s.whatsapp.net', id: 'msg_1' },
            message: { conversation: '.subbot pair ' + TEST_SUBBOT_NUM + ' code' }
        };

        await requestPairing(
            TEST_SUBBOT_NUM,
            'code',
            '628111111111@s.whatsapp.net',
            'chat_test@s.whatsapp.net',
            mockSock,
            mockMsg,
            t
        );

        assert(hasCancellableSession('628111111111', 'chat_test@s.whatsapp.net'), 'Pairing session must be registered');

        const cancelResult = await cancelActiveSession('628111111111', 'chat_test@s.whatsapp.net', mockSock, mockMsg);
        assert(cancelResult?.includes('cancelled'), 'Cancellation response must indicate cancelled');
        assert(!hasCancellableSession('628111111111', 'chat_test@s.whatsapp.net'), 'Pairing session must be removed');
        console.log('✓ Pairing session cancellation verified.\n');

        // [Test 5] Anti-Recursion Protection
        console.log('[Test 5] Testing Anti-Recursion Guard on Sub-Bot Execution...');
        const fakeSubBotContext: any = {
            sock: mockSock,
            msg: mockMsg,
            jid: 'chat_test@s.whatsapp.net',
            t
        };

        // When running in sub-bot session
        const antiRecursionResult = await dbContext.run(
            { sessionId: `sub_${TEST_SUBBOT_NUM}`, prisma: client1 },
            async () => {
                return await subbotTool.execute({ query: `pair ${TEST_SUBBOT_NUM_2} code` }, fakeSubBotContext);
            }
        );

        assert(
            typeof antiRecursionResult === 'string' && antiRecursionResult.includes('ACTION RESTRICTED'),
            'Sub-bot must reject spawning secondary sub-bots'
        );
        console.log('✓ Anti-recursion protection verified.\n');

        // [Test 6] Sub-Bot .config Tool Execution & Feature Toggling
        console.log('[Test 6] Testing .config Tool Execution...');
        const configContext: any = {
            sock: mockSock,
            msg: {
                key: {
                    remoteJid: 'chat_test@s.whatsapp.net',
                    id: 'msg_2',
                    participant: `${TEST_SUBBOT_NUM}@s.whatsapp.net`
                },
                message: { conversation: '.config disable casino' }
            },
            jid: 'chat_test@s.whatsapp.net',
            t
        };

        const toggleResult = await dbContext.run({ sessionId: `sub_${TEST_SUBBOT_NUM}`, prisma: client1 }, async () => {
            return await configTool.execute({ query: 'disable casino' }, configContext);
        });

        assert(
            typeof toggleResult === 'string' && toggleResult.includes('casino'),
            'Toggle response should mention feature'
        );
        assert.strictEqual(isFeatureEnabled(TEST_SUBBOT_NUM, 'casino'), false);

        // Test mode toggle via tool
        await dbContext.run({ sessionId: `sub_${TEST_SUBBOT_NUM}`, prisma: client1 }, async () => {
            await configTool.execute({ query: 'mode self' }, configContext);
        });
        assert.strictEqual(loadConfig(TEST_SUBBOT_NUM).mode, 'self');

        // Test api key config via tool
        await dbContext.run({ sessionId: `sub_${TEST_SUBBOT_NUM}`, prisma: client1 }, async () => {
            await configTool.execute({ query: 'api groq gsk_tooltest123456789' }, configContext);
        });
        assert.strictEqual(loadConfig(TEST_SUBBOT_NUM).apiKeys.groq, 'gsk_tooltest123456789');
        console.log('✓ .config tool execution verified.\n');

        // [Test 7] FOREX Broadcast Suppression
        console.log('[Test 7] Testing FOREX Broadcast Suppression...');
        // Create a mock sub-bot connection
        let broadcastCount = 0;
        const mockSubSock: any = {
            sendMessage: async () => {
                broadcastCount++;
            }
        };
        activeConnections.set(`sub_${TEST_SUBBOT_NUM}`, mockSubSock);

        // Sub-bot has whitelisted group
        await client1.whitelistedGroup.upsert({
            where: { jid: 'forex_group@g.us' },
            update: {},
            create: { jid: 'forex_group@g.us' }
        });

        // 1. Enabled
        updateFeature(TEST_SUBBOT_NUM, 'forexAnnouncement', true);
        await broadcastSubBotForex(1.02, 'Inflation steady', 15500);
        assert(broadcastCount > 0, 'Should broadcast when forexAnnouncement is enabled');

        // 2. Disabled
        broadcastCount = 0;
        updateFeature(TEST_SUBBOT_NUM, 'forexAnnouncement', false);
        await broadcastSubBotForex(1.02, 'Inflation steady', 15500);
        assert.strictEqual(broadcastCount, 0, 'Should NOT broadcast when forexAnnouncement is disabled');

        activeConnections.delete(`sub_${TEST_SUBBOT_NUM}`);
        console.log('✓ FOREX broadcast suppression verified.\n');

        // [Test 8] Deletion of Sub-Bot Data
        console.log('[Test 8] Testing Sub-Bot Deletion...');
        await deleteSubBot(TEST_SUBBOT_NUM);
        const dirAfterDelete = path.resolve(process.cwd(), 'storage', 'sub-bot', TEST_SUBBOT_NUM);
        assert(!fs.existsSync(dirAfterDelete), 'Database directory must be removed on deleteSubBot');
        console.log('✓ Sub-bot deletion verified.\n');

        console.log('====================================================');
        console.log('🎉 ALL SUB-BOT MULTI-DEVICE TESTS PASSED SUCCESSFULLY!');
        console.log('====================================================');
    } finally {
        // Cleanup remaining files
        for (const num of [TEST_SUBBOT_NUM, TEST_SUBBOT_NUM_2]) {
            const dir1 = path.resolve(process.cwd(), 'database', num);
            const dir2 = path.resolve(process.cwd(), 'storage', 'sub-bot', num);
            if (fs.existsSync(dir1)) fs.rmSync(dir1, { recursive: true, force: true });
            if (fs.existsSync(dir2)) fs.rmSync(dir2, { recursive: true, force: true });
            clearConfigCache(num);
        }
        clearAllCancellableSessions();
    }
}

runTests()
    .then(() => {
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ Sub-bot test suite failed:', err);
        process.exit(1);
    });
