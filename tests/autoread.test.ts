import assert from 'assert';
import { handleMessage } from '../src/handlers/message.js';
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';

async function runTests() {
    console.log('--- STARTING AUTO-READ TESTS ---');

    // Test 1: User message with a command triggers sock.readMessages
    console.log('[Test 1] Testing that command messages trigger readMessages...');
    let readKeys: any[] = [];
    const mockSock: Partial<WASocket> = {
        user: { id: '628999999999@s.whatsapp.net' } as any,
        readMessages: async (keys: any[]) => {
            readKeys.push(...keys);
        },
        sendMessage: async () => ({}) as any,
        sendPresenceUpdate: async () => {}
    };

    const commandMsg: WAMessage = {
        key: {
            remoteJid: '628111111111@s.whatsapp.net',
            id: 'CMD_MSG_001',
            fromMe: false
        },
        message: {
            conversation: '.ping'
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
    };

    await handleMessage(mockSock as WASocket, commandMsg);
    assert.strictEqual(readKeys.length, 1, 'Should call readMessages once for command message');
    assert.strictEqual(readKeys[0].id, 'CMD_MSG_001', 'Should mark correct message ID as read');
    assert.strictEqual(readKeys[0].remoteJid, '628111111111@s.whatsapp.net');
    console.log('✓ Command message auto-read verified.');

    // Test 2: Random / unhandled user message triggers sock.readMessages
    console.log('[Test 2] Testing that random/unhandled messages trigger readMessages...');
    readKeys = [];
    const randomMsg: WAMessage = {
        key: {
            remoteJid: '628222222222@s.whatsapp.net',
            id: 'RANDOM_MSG_002',
            fromMe: false
        },
        message: {
            conversation: 'Halo bot, apa kabar?'
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
    };

    await handleMessage(mockSock as WASocket, randomMsg);
    assert.strictEqual(readKeys.length, 1, 'Should call readMessages once for random message');
    assert.strictEqual(readKeys[0].id, 'RANDOM_MSG_002', 'Should mark random message ID as read');
    assert.strictEqual(readKeys[0].remoteJid, '628222222222@s.whatsapp.net');
    console.log('✓ Random/unhandled message auto-read verified.');

    // Test 3: Group message triggers sock.readMessages
    console.log('[Test 3] Testing that group messages trigger readMessages...');
    readKeys = [];
    const groupMsg: WAMessage = {
        key: {
            remoteJid: '1203630123456789@g.us',
            id: 'GROUP_MSG_003',
            fromMe: false,
            participant: '628333333333@s.whatsapp.net'
        },
        message: {
            conversation: 'Hello group!'
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
    };

    await handleMessage(mockSock as WASocket, groupMsg);
    assert.strictEqual(readKeys.length, 1, 'Should call readMessages once for group message');
    assert.strictEqual(readKeys[0].id, 'GROUP_MSG_003', 'Should mark group message ID as read');
    assert.strictEqual(readKeys[0].remoteJid, '1203630123456789@g.us');
    console.log('✓ Group message auto-read verified.');

    // Test 4: Bot's own messages (fromMe) do NOT trigger readMessages
    console.log('[Test 4] Testing that fromMe messages do NOT trigger readMessages...');
    readKeys = [];
    const selfMsg: WAMessage = {
        key: {
            remoteJid: '628111111111@s.whatsapp.net',
            id: 'SELF_MSG_004',
            fromMe: true
        },
        message: {
            conversation: 'This is a bot response'
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
    };

    await handleMessage(mockSock as WASocket, selfMsg);
    assert.strictEqual(readKeys.length, 0, 'Should NOT call readMessages for fromMe messages');
    console.log('✓ fromMe check verified.');

    // Test 5: Status broadcasts and newsletters do NOT trigger readMessages
    console.log('[Test 5] Testing that status broadcast and newsletters are ignored...');
    readKeys = [];
    const statusMsg: WAMessage = {
        key: {
            remoteJid: 'status@broadcast',
            id: 'STATUS_MSG_005',
            fromMe: false
        },
        message: {
            conversation: 'Status update'
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
    };
    const newsletterMsg: WAMessage = {
        key: {
            remoteJid: '12345678@newsletter',
            id: 'NEWSLETTER_MSG_006',
            fromMe: false
        },
        message: {
            conversation: 'Newsletter post'
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
    };

    await handleMessage(mockSock as WASocket, statusMsg);
    await handleMessage(mockSock as WASocket, newsletterMsg);
    assert.strictEqual(readKeys.length, 0, 'Should NOT call readMessages for status or newsletter');
    console.log('✓ Status broadcast and newsletter exclusion verified.');

    console.log('--- ALL AUTO-READ TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
