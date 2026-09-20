import assert from 'assert';
import dotenv from 'dotenv';
dotenv.config();

import {
    searchStickerly,
    getStickerPackDetails,
    fetchAndNormalizeThumbnail,
    extractStickerlyPackId
} from '../src/services/stickerlyService.js';
import {
    normalizeStickerBuffer,
    generateTrayIcon,
    buildWastickersZip,
    buildMmsZip,
    isValidWebP
} from '../src/utils/stickerPackBuilder.js';
import {
    registerStickerlySession,
    getStickerlySession,
    hasActiveStickerlySession,
    deleteStickerlySession,
    deletePreviewMessages,
    processStickerlySelection,
    StickerlySession
} from '../src/utils/stickerlySession.js';
import {
    registerCancellableSession,
    hasCancellableSession,
    cancelActiveSession
} from '../src/utils/cancellationManager.js';
import crypto from 'crypto';
import { hkdf } from '@whiskeysockets/baileys';
import axios from 'axios';

async function runTests() {
    console.log('--- STARTING STICKER.LY SEARCH & EXPORT TESTS ---');

    // [Test 1] extractStickerlyPackId
    console.log('[Test 1] Testing extractStickerlyPackId...');
    assert.strictEqual(extractStickerlyPackId('https://sticker.ly/s/OD5GZR'), 'OD5GZR');
    assert.strictEqual(extractStickerlyPackId('http://sticker.ly/s/SMFF38/'), 'SMFF38');
    assert.strictEqual(extractStickerlyPackId('OD5GZR'), 'OD5GZR');
    assert.strictEqual(extractStickerlyPackId('chibi'), null);
    assert.strictEqual(extractStickerlyPackId('anime'), null);
    assert.strictEqual(extractStickerlyPackId('random search phrase with spaces'), null);
    console.log('✓ extractStickerlyPackId passed');

    // [Test 2] searchStickerly via Dongtube API
    console.log('[Test 2] Testing searchStickerly("Chibi")...');
    const searchResults = await searchStickerly('Chibi');
    assert(Array.isArray(searchResults), 'searchResults should be an array');
    assert(searchResults.length > 0, 'searchResults should contain items');
    assert(searchResults.length <= 5, 'searchResults should have at most 5 items');
    const firstPack = searchResults[0];
    assert(firstPack.name, 'First pack should have a name');
    assert(firstPack.author, 'First pack should have an author');
    assert(firstPack.thumbnail, 'First pack should have a thumbnail URL');
    assert(firstPack.packId, 'First pack should have an extracted packId');
    console.log(
        `✓ searchStickerly returned ${searchResults.length} packs. First: "${firstPack.name}" (ID: ${firstPack.packId})`
    );

    // [Test 3] getStickerPackDetails from Sticker.ly
    console.log('[Test 3] Testing getStickerPackDetails...');
    const packDetails = await getStickerPackDetails(firstPack.packId);
    assert.strictEqual(packDetails.packId, firstPack.packId);
    assert(packDetails.stickers.length > 0, 'Pack should have stickers');
    assert(packDetails.resourceUrlPrefix, 'Pack should have resourceUrlPrefix');
    console.log(`✓ getStickerPackDetails succeeded with ${packDetails.stickers.length} stickers`);

    // [Test 4] fetchAndNormalizeThumbnail
    console.log('[Test 4] Testing fetchAndNormalizeThumbnail...');
    const normalizedThumb = await fetchAndNormalizeThumbnail(firstPack.thumbnail, firstPack.animated);
    assert(normalizedThumb.buffer.length > 0, 'Thumbnail buffer should not be empty');
    assert.strictEqual(normalizedThumb.type, 'image', 'Thumbnail must be image');
    console.log(
        `✓ fetchAndNormalizeThumbnail succeeded with type "${normalizedThumb.type}" (${normalizedThumb.buffer.length} bytes)`
    );

    // [Test 5] Image normalization and tray icon generation with Sharp
    console.log('[Test 5] Testing sticker normalization and tray icon generation...');
    const firstSticker = packDetails.stickers[0];
    const dlUrl = `${packDetails.resourceUrlPrefix}${firstSticker.fileName}`;
    const dlRes = await axios.get(dlUrl, { responseType: 'arraybuffer' });
    const rawStickerBuf = Buffer.from(dlRes.data);

    const normStickerBuf = await normalizeStickerBuffer(rawStickerBuf, firstSticker.isAnimated);
    assert(isValidWebP(normStickerBuf), 'Normalized buffer must be valid WebP');
    assert(normStickerBuf.length <= 1024 * 1024, 'Normalized buffer must be <= 1MB');

    const trayPng = await generateTrayIcon(normStickerBuf);
    assert(trayPng.length > 0, 'Tray PNG should not be empty');
    console.log(
        `✓ Sticker normalization and tray icon generation passed (WebP: ${normStickerBuf.length}b, Tray: ${trayPng.length}b)`
    );

    // [Test 6] Packaging: .wastickers and MMS ZIP containers
    console.log('[Test 6] Testing buildWastickersZip and buildMmsZip...');
    const sampleStickers = [{ buffer: normStickerBuf, isAnimated: firstSticker.isAnimated, emojis: ['✨', '❤️'] }];
    const wastickersZip = buildWastickersZip(packDetails, sampleStickers, trayPng);
    assert(wastickersZip.length > 0, '.wastickers ZIP should not be empty');

    const mmsZip = buildMmsZip(packDetails, sampleStickers, trayPng);
    assert(mmsZip.zipBuffer.length > 0, 'MMS ZIP should not be empty');
    assert.strictEqual(mmsZip.stickersList.length, 1);
    assert.strictEqual(mmsZip.trayFileName, `${packDetails.packId}.png`);
    console.log(`✓ Packaging passed (.wastickers: ${wastickersZip.length}b, MMS ZIP: ${mmsZip.zipBuffer.length}b)`);

    // [Test 7] WhatsApp MMS encryption with HKDF
    console.log('[Test 7] Testing WhatsApp Sticker Pack Keys encryption...');
    const mediaKey = crypto.randomBytes(32);
    const expandedMediaKey = hkdf(mediaKey, 112, { info: 'WhatsApp Sticker Pack Keys' });
    assert.strictEqual(expandedMediaKey.length, 112, 'Expanded key must be 112 bytes');

    const iv = expandedMediaKey.slice(0, 16);
    const cipherKey = expandedMediaKey.slice(16, 48);
    const macKey = expandedMediaKey.slice(48, 80);

    const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
    const encData = Buffer.concat([cipher.update(mmsZip.zipBuffer), cipher.final()]);
    const hmac = crypto.createHmac('sha256', macKey);
    hmac.update(iv);
    hmac.update(encData);
    const mac = hmac.digest().slice(0, 10);
    const finalEnc = Buffer.concat([encData, mac]);
    assert(finalEnc.length > mmsZip.zipBuffer.length, 'Encrypted payload must contain ciphertext + MAC');
    console.log(`✓ Encryption passed (encrypted size: ${finalEnc.length}b)`);

    // [Test 8] Session management, selection by number, and batch deletion
    console.log('[Test 8] Testing session management and number selection...');
    const testUser = '628999999999';
    const testChat = 'test_group@g.us';

    const deletedMessageKeys: any[] = [];
    const mockSock: any = {
        sendMessage: async (jid: string, content: any) => {
            if (content.delete) {
                deletedMessageKeys.push(content.delete);
                return;
            }
            return { key: { id: `mock_msg_${Date.now()}_${Math.random()}` } };
        },
        waUploadToServer: async () => {
            return { directPath: '/mock/direct/path' };
        },
        relayMessage: async () => {
            return {};
        }
    };

    const mockPreviewKeys = [
        { id: 'prev_1', remoteJid: testChat, fromMe: true },
        { id: 'prev_2', remoteJid: testChat, fromMe: true },
        { id: 'prev_3', remoteJid: testChat, fromMe: true }
    ];

    const session: StickerlySession = {
        chatJid: testChat,
        userJid: testUser,
        query: 'Chibi',
        packs: searchResults.slice(0, 3),
        previewMessageKeys: mockPreviewKeys,
        guideMessageKey: { id: 'guide_1', remoteJid: testChat, fromMe: true },
        timer: setTimeout(() => {}, 60000)
    };

    registerStickerlySession(session);
    assert(hasActiveStickerlySession(testUser, testChat));

    registerCancellableSession({
        sessionId: `stickerly_${testUser}_${testChat}`,
        feature: 'stickerly',
        userJid: testUser,
        chatJid: testChat,
        onCancel: async (sock) => {
            const s = getStickerlySession(testUser, testChat);
            if (s) {
                clearTimeout(s.timer);
                await deletePreviewMessages(sock, testChat, [...s.previewMessageKeys, s.guideMessageKey!]);
                deleteStickerlySession(testUser, testChat);
            }
            return 'Cancelled';
        }
    });

    const fakeMsg = {
        key: { id: 'user_reply_1', remoteJid: testChat, participant: `${testUser}@s.whatsapp.net` },
        message: { conversation: '2' }
    } as any;

    const handled = await processStickerlySelection(mockSock, fakeMsg, testUser, testChat, '2', (k) => k);

    assert.strictEqual(handled, true, 'processStickerlySelection should return true for valid number');
    assert.strictEqual(
        hasActiveStickerlySession(testUser, testChat),
        false,
        'Session should be cleared after selection'
    );
    assert(deletedMessageKeys.length >= 4, 'All preview messages and guide message should be deleted');
    console.log('✓ Selection by number and immediate delete-for-everyone passed');

    // [Test 9] Global cancellation system (.cancel) integration
    console.log('[Test 9] Testing global cancellation integration...');
    const cancelDeletedKeys: any[] = [];
    const mockCancelSock: any = {
        sendMessage: async (jid: string, content: any) => {
            if (content.delete) {
                cancelDeletedKeys.push(content.delete);
                return;
            }
            return { key: { id: `mock_msg_${Date.now()}` } };
        }
    };

    const cancelSession: StickerlySession = {
        chatJid: testChat,
        userJid: testUser,
        query: 'Anime',
        packs: searchResults.slice(0, 2),
        previewMessageKeys: [
            { id: 'cprev_1', remoteJid: testChat, fromMe: true },
            { id: 'cprev_2', remoteJid: testChat, fromMe: true }
        ],
        guideMessageKey: { id: 'cguide_1', remoteJid: testChat, fromMe: true },
        timer: setTimeout(() => {}, 60000)
    };

    registerStickerlySession(cancelSession);
    registerCancellableSession({
        sessionId: `stickerly_${testUser}_${testChat}`,
        feature: 'stickerly',
        userJid: testUser,
        chatJid: testChat,
        onCancel: async (sock) => {
            const s = getStickerlySession(testUser, testChat);
            if (s) {
                clearTimeout(s.timer);
                await deletePreviewMessages(sock, testChat, [...s.previewMessageKeys, s.guideMessageKey!]);
                deleteStickerlySession(testUser, testChat);
            }
            return 'Cancelled';
        }
    });

    assert(hasCancellableSession(testUser, testChat));
    const cancelResult = await cancelActiveSession(testUser, testChat, mockCancelSock, null);
    assert.strictEqual(cancelResult, 'Cancelled');
    assert.strictEqual(hasActiveStickerlySession(testUser, testChat), false);
    assert.strictEqual(
        cancelDeletedKeys.length,
        3,
        'All preview messages and guide message should be deleted on cancel'
    );
    console.log('✓ Cancellation via .cancel and immediate delete-for-everyone passed');

    // [Test 10] Quoting preview message with "This" by another user in group chat
    console.log('[Test 10] Testing quoting preview card with "This" by another user in group chat...');
    const userA = '628111111111';
    const userB = '628222222222';
    const groupChat = '120363274823554999@g.us';

    const groupDeletedKeys: any[] = [];
    const mockGroupSock: any = {
        sendMessage: async (jid: string, content: any) => {
            if (content.delete) {
                groupDeletedKeys.push(content.delete);
                return;
            }
            return { key: { id: `mock_msg_${Date.now()}` } };
        },
        waUploadToServer: async () => ({ directPath: '/mock/direct/path' }),
        relayMessage: async () => ({})
    };

    const groupSession: StickerlySession = {
        chatJid: groupChat,
        userJid: userA,
        query: 'Anime',
        packs: searchResults.slice(0, 3),
        previewMessageKeys: [
            { id: 'prev_a1', remoteJid: groupChat, fromMe: true },
            { id: 'prev_a2', remoteJid: groupChat, fromMe: true },
            { id: 'prev_a3', remoteJid: groupChat, fromMe: true }
        ],
        guideMessageKey: { id: 'guide_a1', remoteJid: groupChat, fromMe: true },
        timer: setTimeout(() => {}, 60000)
    };

    registerStickerlySession(groupSession);

    // Verify session is active by chat ID even when checked with userB
    assert(hasActiveStickerlySession(groupChat), 'Session must be active for groupChat');
    assert(hasActiveStickerlySession(userB, groupChat), 'Session must be active for userB in groupChat');

    // Simulate userB replying to preview #3 with "This"
    const quoteMsgFromUserB = {
        key: { id: 'reply_msg_99', remoteJid: groupChat, participant: `${userB}@s.whatsapp.net` },
        message: {
            extendedTextMessage: {
                text: 'This',
                contextInfo: {
                    stanzaId: 'prev_a3',
                    quotedMessage: {
                        imageMessage: {
                            caption: '*STICKER PACK #3*\n📦 *Title:* Pack 3\n👤 *Author:* Someone'
                        }
                    }
                }
            }
        }
    } as any;

    const groupHandled = await processStickerlySelection(
        mockGroupSock,
        quoteMsgFromUserB,
        userB,
        groupChat,
        'This',
        (k) => k
    );
    assert.strictEqual(groupHandled, true, 'Quoting preview #3 with "This" must be handled');
    assert.strictEqual(hasActiveStickerlySession(groupChat), false, 'Session must be cleared after selection');
    assert(groupDeletedKeys.length >= 4, 'All preview messages and guide must be deleted');
    console.log('✓ Group-wide selection quoting preview with "This" passed');

    console.log('\n========================================');
    console.log('🎉 ALL STICKER.LY TESTS PASSED SUCCESSFULLY!');
    console.log('========================================');
    process.exit(0);
}

runTests().catch((err) => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
