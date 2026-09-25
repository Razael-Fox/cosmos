import assert from 'node:assert';
import {
    isAutoArchiveEnabled,
    setAutoArchive,
    clearSystemConfigCache,
    getSystemConfig
} from '../src/services/systemConfigService.js';
import {
    getDefaultFeatures,
    loadConfig,
    updateFeature,
    isFeatureEnabled,
    clearConfigCache
} from '../src/services/subBotConfigService.js';
import {
    recordMessage,
    getLastMessage,
    waitForLastMessage,
    archiveChat,
    unarchiveChat,
    clearChatArchiveCache,
    ChatLastMessage
} from '../src/services/chatArchiveService.js';
import { execute as executeAutoArchive } from '../src/tools/autoarchive.js';
import { execute as executeWhitelist } from '../src/tools/whitelist.js';
import type { ToolContext } from '../src/tools/types.js';
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { getTranslator } from '../src/utils/i18n.js';

async function runTests() {
    console.log('--- STARTING AUTO-ARCHIVE SYSTEM TEST SUITE ---');

    const t = getTranslator('en');
    const ownerNumber = '6282225907841@s.whatsapp.net';
    const nonOwnerNumber = '628111111111@s.whatsapp.net';

    // =========================================================================
    // 1. SystemConfigService autoArchiveOnJoin Persistence & Toggling
    // =========================================================================
    console.log('[Test 1] Testing SystemConfigService auto-archive toggling & persistence...');
    clearSystemConfigCache();

    setAutoArchive(false);
    assert.strictEqual(isAutoArchiveEnabled(), false, 'Auto-archive should be false when set to false');
    assert.strictEqual(getSystemConfig().autoArchiveOnJoin, false);

    setAutoArchive(true);
    assert.strictEqual(isAutoArchiveEnabled(), true, 'Auto-archive should be true after setAutoArchive(true)');
    assert.strictEqual(getSystemConfig().autoArchiveOnJoin, true);

    // Verify cache invalidation & reload from disk
    clearSystemConfigCache();
    assert.strictEqual(isAutoArchiveEnabled(), true, 'Persisted auto-archive setting should survive cache reload');

    setAutoArchive(false);
    assert.strictEqual(isAutoArchiveEnabled(), false);
    console.log('  ✔ SystemConfigService autoArchiveOnJoin persistence passed.');

    // =========================================================================
    // 2. SubBotConfigService autoarchive Feature Toggle
    // =========================================================================
    console.log('[Test 2] Testing SubBotConfigService autoarchive feature toggle...');
    const defaults = getDefaultFeatures();
    assert.strictEqual(defaults.autoarchive, true, 'Default sub-bot features must include autoarchive: true');

    const testSubBotNum = '628999888777';
    clearConfigCache(testSubBotNum);

    const initialConfig = loadConfig(testSubBotNum);
    assert.strictEqual(initialConfig.features.autoarchive, true, 'Sub-bot should default to autoarchive: true');
    assert.strictEqual(isFeatureEnabled(testSubBotNum, 'autoarchive'), true);

    // Toggle off for sub-bot
    const updated = updateFeature(testSubBotNum, 'autoarchive', false);
    assert(updated, 'updateFeature should return updated config');
    assert.strictEqual(updated?.features.autoarchive, false);
    assert.strictEqual(isFeatureEnabled(testSubBotNum, 'autoarchive'), false);

    // Re-enable
    updateFeature(testSubBotNum, 'autoarchive', true);
    assert.strictEqual(isFeatureEnabled(testSubBotNum, 'autoarchive'), true);
    console.log('  ✔ SubBotConfigService autoarchive feature toggle passed.');

    // =========================================================================
    // 3. ChatArchiveService Message Tracking & Cache Invalidation
    // =========================================================================
    console.log('[Test 3] Testing ChatArchiveService message recording & tracking...');
    clearChatArchiveCache();

    const groupJid = '120363000111222@g.us';
    const participantJid = '628123456789@s.whatsapp.net';

    const mockMessage: WAMessage = {
        key: {
            remoteJid: groupJid,
            id: 'MSG_12345_ABC',
            fromMe: false,
            participant: participantJid
        },
        messageTimestamp: 1720000000
    };

    recordMessage(mockMessage);

    const recorded = getLastMessage(groupJid);
    assert(recorded, 'Last message should be recorded in tracker');
    assert.strictEqual(recorded?.key.remoteJid, groupJid);
    assert.strictEqual(recorded?.key.id, 'MSG_12345_ABC');
    assert.strictEqual(recorded?.key.fromMe, false);
    assert.strictEqual(recorded?.key.participant, participantJid);
    assert.strictEqual(recorded?.messageTimestamp, 1720000000);
    console.log('  ✔ ChatArchiveService message recording passed.');

    // =========================================================================
    // 4. ChatArchiveService waitForLastMessage (Instant & Async Resolution)
    // =========================================================================
    console.log('[Test 4] Testing waitForLastMessage async resolution & timeout...');

    // 4a. Immediate resolution for cached message
    const instant = await waitForLastMessage(groupJid, 500);
    assert(instant, 'waitForLastMessage should resolve immediately if already cached');
    assert.strictEqual(instant?.key.id, 'MSG_12345_ABC');

    // 4b. Async resolution when message arrives while waiting
    const newGroupJid = '120363999888777@g.us';
    let asyncResolved: ChatLastMessage | null = null;

    const waitPromise = waitForLastMessage(newGroupJid, 1000).then((res) => {
        asyncResolved = res;
    });

    // Simulate incoming message via microtask queue
    queueMicrotask(() => {
        recordMessage({
            key: {
                remoteJid: newGroupJid,
                id: 'STUB_JOIN_MSG_999',
                fromMe: false,
                participant: participantJid
            },
            messageTimestamp: 1720001000
        });
    });
    await waitPromise;
    assert(asyncResolved, 'waitForLastMessage should resolve when recordMessage is invoked');
    assert.strictEqual((asyncResolved as ChatLastMessage)?.key.id, 'STUB_JOIN_MSG_999');

    // 4c. Timeout when no message arrives
    const timedOut = await waitForLastMessage('120363999999999@g.us', 100);
    assert.strictEqual(timedOut, null, 'waitForLastMessage should return null on timeout');
    console.log('  ✔ waitForLastMessage async resolution and timeout passed.');

    // =========================================================================
    // 5. ChatArchiveService archiveChat & unarchiveChat Payload Safety
    // =========================================================================
    console.log('[Test 5] Testing archiveChat & unarchiveChat Baileys chatModify safety...');

    const capturedModifications: Array<{ mod: any; jid: string }> = [];

    const mockSock = {
        chatModify: async (mod: any, jid: string) => {
            capturedModifications.push({ mod, jid });
        }
    } as unknown as WASocket;

    // 5a. Archive with recorded group message (fromMe = false, with participant)
    const successArchive = await archiveChat(mockSock, groupJid);
    assert.strictEqual(successArchive, true);
    assert.strictEqual(capturedModifications.length, 1);
    const mod1 = capturedModifications[0].mod;
    assert.strictEqual(mod1.archive, true);
    assert(Array.isArray(mod1.lastMessages), 'lastMessages should be array when valid message exists');
    assert.strictEqual(mod1.lastMessages[0].key.remoteJid, groupJid);
    assert.strictEqual(mod1.lastMessages[0].key.participant, participantJid);
    assert.strictEqual(mod1.lastMessages[0].messageTimestamp, 1720000000);

    // 5b. Unarchive chat
    const successUnarchive = await unarchiveChat(mockSock, groupJid);
    assert.strictEqual(successUnarchive, true);
    assert.strictEqual(capturedModifications.length, 2);
    const mod2 = capturedModifications[1].mod;
    assert.strictEqual(mod2.archive, false);

    // 5c. Archive chat with no message history (must safely fallback to messageRange object)
    const unknownGroupJid = '120363000999888@g.us';
    const successFallback = await archiveChat(mockSock, unknownGroupJid, { timeoutMs: 50 });
    assert.strictEqual(successFallback, true);
    assert.strictEqual(capturedModifications.length, 3);
    const mod3 = capturedModifications[2].mod;
    assert.strictEqual(mod3.archive, true);
    assert(!Array.isArray(mod3.lastMessages), 'Fallback should pass messageRange object to prevent Boom exception');
    assert(typeof mod3.lastMessages.lastMessageTimestamp === 'number');

    // 5d. Handle chatModify exception gracefully
    const failingSock = {
        chatModify: async () => {
            throw new Error('Connection closed by peer');
        }
    } as unknown as WASocket;
    const failResult = await archiveChat(failingSock, groupJid);
    assert.strictEqual(failResult, false, 'archiveChat should return false on error without crashing');
    console.log('  ✔ archiveChat & unarchiveChat Baileys chatModify safety passed.');

    // =========================================================================
    // 6. autoarchive Tool Execution & Authorization Gate
    // =========================================================================
    console.log('[Test 6] Testing autoarchive tool commands & permissions...');

    const sentMessages: Array<{ destJid: string; text: string }> = [];
    const testToolSock = {
        sendMessage: async (destJid: string, content: { text: string }) => {
            sentMessages.push({ destJid, text: content.text });
            return {};
        },
        chatModify: async (mod: any, jid: string) => {
            capturedModifications.push({ mod, jid });
        }
    } as unknown as WASocket;

    const makeCtx = (caller: string, text: string, chatJid: string = groupJid): ToolContext => ({
        sock: testToolSock,
        msg: {
            key: {
                remoteJid: chatJid,
                fromMe: false,
                participant: caller
            },
            message: {
                conversation: text
            }
        } as unknown as WAMessage,
        jid: chatJid,
        args: text.split(' ').slice(1),
        t
    });

    // 6a. Non-owner cannot toggle auto-archive
    sentMessages.length = 0;
    await executeAutoArchive({ subcommand: 'on' }, makeCtx(nonOwnerNumber, '.autoarchive on'));
    assert(sentMessages.length > 0);
    assert(sentMessages[0].text.toLowerCase().includes('authorized'));
    assert.strictEqual(isAutoArchiveEnabled(), false, 'Non-owner must not be able to enable auto-archive');

    // 6b. Owner enables auto-archive
    sentMessages.length = 0;
    await executeAutoArchive({ subcommand: 'on' }, makeCtx(ownerNumber, '.autoarchive on'));
    assert.strictEqual(isAutoArchiveEnabled(), true);
    assert(sentMessages[0].text.includes('ENABLED'));

    // 6c. Owner disables auto-archive
    sentMessages.length = 0;
    await executeAutoArchive({ subcommand: 'off' }, makeCtx(ownerNumber, '.autoarchive off'));
    assert.strictEqual(isAutoArchiveEnabled(), false);
    assert(sentMessages[0].text.includes('DISABLED'));

    // 6d. Status dashboard
    sentMessages.length = 0;
    await executeAutoArchive({}, makeCtx(ownerNumber, '.autoarchive'));
    assert(sentMessages[0].text.includes('Auto-Archive Settings'));
    assert(sentMessages[0].text.includes('Available Actions'));

    // 6e. Manual archive via .archive inside group
    sentMessages.length = 0;
    await executeAutoArchive({ subcommand: 'archive' }, makeCtx(ownerNumber, '.archive', groupJid));
    assert(sentMessages[0].text.includes('Chat Archived'));

    // 6f. Manual unarchive via .unarchive inside group
    sentMessages.length = 0;
    await executeAutoArchive({ subcommand: 'unarchive' }, makeCtx(ownerNumber, '.unarchive', groupJid));
    assert(sentMessages[0].text.includes('Chat Unarchived'));
    console.log('  ✔ autoarchive tool commands & permissions passed.');

    // =========================================================================
    // 7. Whitelist Tool Integration with Auto-Archive
    // =========================================================================
    console.log('[Test 7] Testing whitelist tool auto-archive integration...');

    sentMessages.length = 0;
    await executeWhitelist({}, makeCtx(ownerNumber, '.whitelist'));
    assert(sentMessages.length > 0);
    assert(
        sentMessages[0].text.includes('Auto-Archive on Join'),
        'Whitelist dashboard must display Auto-Archive status'
    );

    // Toggle auto-archive via .whitelist auto archive on
    sentMessages.length = 0;
    await executeWhitelist(
        { subcommand: 'auto', target: 'archive' },
        makeCtx(ownerNumber, '.whitelist auto archive on')
    );
    assert.strictEqual(isAutoArchiveEnabled(), true, 'Whitelist auto archive on should enable auto-archive');

    console.log('  ✔ Whitelist tool auto-archive integration passed.');

    console.log('\n--- ALL AUTO-ARCHIVE TESTS COMPLETED SUCCESSFULLY! ---');
}

runTests().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
