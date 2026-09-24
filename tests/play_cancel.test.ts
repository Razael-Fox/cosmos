import assert from 'assert';
import {
    registerPlaySession,
    getActivePlaySession,
    hasActivePlaySession,
    clearPlaySession,
    clearAllPlaySessions
} from '../src/utils/playSession.js';
import { hasCancellableSession, cancelActiveSession } from '../src/utils/cancellationManager.js';
import cancelTool from '../src/tools/cancel.js';
import { getTranslator } from '../src/utils/i18n.js';

async function runPlayCancelTests() {
    console.log('--- STARTING PLAY CANCELLATION INTEGRATION TESTS ---');
    const tEn = getTranslator('en');
    const tId = getTranslator('id');
    const userJid = '628999999999';
    const chatJid = 'play_test_group@g.us';

    // [Test 1] Session registration and cancellation in English
    console.log('[Test 1] Testing play session registration and cancellation in English...');
    clearAllPlaySessions();
    assert.strictEqual(hasActivePlaySession(userJid, chatJid), false);
    assert.strictEqual(hasCancellableSession(userJid, chatJid), false);

    const mockResults = [
        { index: 1, title: 'Rick Astley - Never Gonna Give You Up', url: 'https://youtube.com/watch?v=dQw4w9WgXcQ' },
        { index: 2, title: 'Rick Astley - Together Forever', url: 'https://youtube.com/watch?v=yPYZpwSpKmA' }
    ];

    let deletedKey: any = null;
    const mockSock: any = {
        sendMessage: async (jid: string, content: any) => {
            if (content.delete) {
                deletedKey = content.delete;
            }
            return { key: { remoteJid: jid, id: 'MSG_SEARCH_1' } };
        }
    };

    registerPlaySession(
        {
            userJid,
            chatJid,
            query: 'Rick Astley',
            results: mockResults,
            enableLyrics: true,
            messageKey: { remoteJid: chatJid, fromMe: true, id: 'MSG_SEARCH_1' },
            createdAt: Date.now()
        },
        tEn
    );

    assert.strictEqual(hasActivePlaySession(userJid, chatJid), true);
    assert.strictEqual(hasCancellableSession(userJid, chatJid), true);

    const session = getActivePlaySession(userJid, chatJid);
    assert.strictEqual(session?.query, 'Rick Astley');
    assert.strictEqual(session?.enableLyrics, true);
    assert.strictEqual(session?.results.length, 2);

    // Cancel using cancelTool
    const ctxEn: any = {
        sock: mockSock,
        msg: {
            key: { remoteJid: chatJid, participant: `${userJid}@s.whatsapp.net`, fromMe: false },
            message: { conversation: '.cancel' }
        },
        jid: chatJid,
        t: tEn
    };

    const cancelResultEn = await cancelTool.execute({}, ctxEn);
    assert.strictEqual(cancelResultEn, 'YouTube music playback selection has been cancelled.');
    assert.strictEqual(hasActivePlaySession(userJid, chatJid), false);
    assert.strictEqual(hasCancellableSession(userJid, chatJid), false);
    assert.deepStrictEqual(deletedKey, { remoteJid: chatJid, fromMe: true, id: 'MSG_SEARCH_1' });
    console.log('✓ English play session registration & cancellation verified.');

    // [Test 2] Session cancellation in Indonesian
    console.log('[Test 2] Testing play session cancellation in Indonesian...');
    registerPlaySession(
        {
            userJid,
            chatJid,
            query: 'Lagu Indonesia',
            results: mockResults,
            enableLyrics: false,
            messageKey: { remoteJid: chatJid, fromMe: true, id: 'MSG_SEARCH_2' },
            createdAt: Date.now()
        },
        tId
    );

    assert.strictEqual(hasActivePlaySession(userJid, chatJid), true);
    const cancelMsgId = await cancelActiveSession(userJid, chatJid, mockSock, {}, tId);
    assert.strictEqual(cancelMsgId, 'Pemilihan pemutaran musik YouTube telah dibatalkan.');
    assert.strictEqual(hasActivePlaySession(userJid, chatJid), false);
    assert.strictEqual(hasCancellableSession(userJid, chatJid), false);
    console.log('✓ Indonesian play session cancellation verified.');

    // [Test 3] Selection resolution & cleanup (simulating user picking a song number)
    console.log('[Test 3] Testing selection resolution & cleanup...');
    registerPlaySession(
        {
            userJid,
            chatJid,
            query: 'Rick Astley',
            results: mockResults,
            enableLyrics: true,
            messageKey: { remoteJid: chatJid, fromMe: true, id: 'MSG_SEARCH_3' },
            createdAt: Date.now()
        },
        tEn
    );

    // Retrieve active session for numeric choice 2
    const currentSession = getActivePlaySession(userJid, chatJid);
    assert(currentSession !== undefined);
    const chosenIndex = 2;
    const chosenSong = currentSession.results[chosenIndex - 1];
    assert.strictEqual(chosenSong.url, 'https://youtube.com/watch?v=yPYZpwSpKmA');
    assert.strictEqual(chosenSong.title, 'Rick Astley - Together Forever');

    // Completing selection clears the session
    const cleared = clearPlaySession(userJid, chatJid);
    assert.strictEqual(cleared, true);
    assert.strictEqual(hasActivePlaySession(userJid, chatJid), false);
    assert.strictEqual(hasCancellableSession(userJid, chatJid), false);
    console.log('✓ Play selection resolution and cleanup verified.');

    // [Test 4] User and chat isolation
    console.log('[Test 4] Testing user and chat isolation...');
    const userA = '628111111111';
    const userB = '628222222222';
    const group1 = 'group1@g.us';
    const group2 = 'group2@g.us';

    registerPlaySession(
        {
            userJid: userA,
            chatJid: group1,
            query: 'A1',
            results: mockResults,
            enableLyrics: false,
            createdAt: Date.now()
        },
        tEn
    );
    registerPlaySession(
        {
            userJid: userB,
            chatJid: group1,
            query: 'B1',
            results: mockResults,
            enableLyrics: false,
            createdAt: Date.now()
        },
        tEn
    );
    registerPlaySession(
        {
            userJid: userA,
            chatJid: group2,
            query: 'A2',
            results: mockResults,
            enableLyrics: false,
            createdAt: Date.now()
        },
        tEn
    );

    assert.strictEqual(hasActivePlaySession(userA, group1), true);
    assert.strictEqual(hasActivePlaySession(userB, group1), true);
    assert.strictEqual(hasActivePlaySession(userA, group2), true);
    assert.strictEqual(hasActivePlaySession(userB, group2), false);

    clearPlaySession(userA, group1);
    assert.strictEqual(hasActivePlaySession(userA, group1), false);
    assert.strictEqual(hasActivePlaySession(userB, group1), true);
    assert.strictEqual(hasActivePlaySession(userA, group2), true);

    clearAllPlaySessions();
    assert.strictEqual(hasActivePlaySession(userB, group1), false);
    assert.strictEqual(hasActivePlaySession(userA, group2), false);
    console.log('✓ User and chat isolation verified.');

    // [Test 5] In-flight download cancellation
    console.log('[Test 5] Testing in-flight download cancellation...');
    const abortController = new AbortController();
    let downloadAborted = false;

    registerPlaySession(
        {
            userJid,
            chatJid,
            query: 'song',
            results: mockResults,
            enableLyrics: false,
            createdAt: Date.now()
        },
        tEn
    );

    // Now simulating download start:
    clearPlaySession(userJid, chatJid);
    const { registerCancellableSession } = await import('../src/utils/cancellationManager.js');
    const dlSessionId = `play_dl_${userJid}_${Date.now()}`;

    registerCancellableSession({
        sessionId: dlSessionId,
        feature: 'play',
        userJid,
        chatJid,
        descriptionKey: 'media.play.download_cancellation_desc',
        descriptionVars: { query: 'Never Gonna Give You Up' },
        description: 'YouTube audio download for "Never Gonna Give You Up"',
        onCancel: async () => {
            abortController.abort();
            downloadAborted = true;
            return tEn('media.play.download_cancelled');
        }
    });

    assert.strictEqual(hasCancellableSession(userJid, chatJid), true);
    const dlCancelMsg = await cancelActiveSession(userJid, chatJid, mockSock, {}, tEn);
    assert.strictEqual(dlCancelMsg, 'YouTube audio download has been cancelled.');
    assert.strictEqual(downloadAborted, true);
    assert.strictEqual(abortController.signal.aborted, true);
    assert.strictEqual(hasCancellableSession(userJid, chatJid), false);
    console.log('✓ In-flight download cancellation verified.');

    console.log('--- ALL PLAY CANCELLATION TESTS PASSED SUCCESSFULLY! ---');
}

runPlayCancelTests().catch((err) => {
    console.error('Play cancel test failed:', err);
    process.exit(1);
});
