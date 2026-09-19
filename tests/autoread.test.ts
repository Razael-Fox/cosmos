import assert from 'assert';
import { handleMessage } from '../src/handlers/message.js';
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';

async function runTests() {
    console.log('--- STARTING ANTI-BOT DETECTION & AUTO-READ TESTS ---');

    const botJid = '628999999999@s.whatsapp.net';
    const botLid = '252454654447629@lid';

    let readKeys: any[] = [];
    let presenceUpdates: { type: string; toJid?: string }[] = [];

    function createMockSocket(): Partial<WASocket> {
        return {
            user: { id: botJid, lid: botLid } as any,
            readMessages: async (keys: any[]) => {
                readKeys.push(...keys);
            },
            sendMessage: async () => ({}) as any,
            sendPresenceUpdate: async (type: any, toJid?: string) => {
                presenceUpdates.push({ type, toJid });
            }
        };
    }

    // Test 1: User message with a command triggers sock.readMessages and presence
    console.log('[Test 1] Testing that command messages in a group trigger readMessages and presence...');
    readKeys = [];
    presenceUpdates = [];
    let mockSock = createMockSocket();

    const commandMsg: WAMessage = {
        key: {
            remoteJid: '1203630123456789@g.us',
            id: 'CMD_MSG_001',
            fromMe: false,
            participant: '628111111111@s.whatsapp.net'
        },
        message: {
            conversation: '.ping'
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
    };

    await handleMessage(mockSock as WASocket, commandMsg);
    assert.strictEqual(readKeys.length, 1, 'Should call readMessages once for command message');
    assert.strictEqual(readKeys[0].id, 'CMD_MSG_001');
    assert.strictEqual(readKeys[0].remoteJid, '1203630123456789@g.us');
    assert(
        presenceUpdates.some((p) => p.type === 'available'),
        'Should send presence available on command'
    );
    assert(
        presenceUpdates.some((p) => p.type === 'composing' && p.toJid === '1203630123456789@g.us'),
        'Should send presence composing to group'
    );
    console.log('✓ Command message auto-read and presence verified.');

    // Test 2: Passive/unrelated group message does NOT trigger readMessages or presence
    console.log('[Test 2] Testing that passive chatter in a group is ignored (no read receipt, no presence)...');
    readKeys = [];
    presenceUpdates = [];
    mockSock = createMockSocket();

    const passiveGroupMsg: WAMessage = {
        key: {
            remoteJid: '1203630123456789@g.us',
            id: 'PASSIVE_MSG_002',
            fromMe: false,
            participant: '628222222222@s.whatsapp.net'
        },
        message: {
            conversation: 'Anyone watching the football match tonight?'
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
    };

    await handleMessage(mockSock as WASocket, passiveGroupMsg);
    assert.strictEqual(readKeys.length, 0, 'Must NOT mark passive group message as read');
    assert.strictEqual(presenceUpdates.length, 0, 'Must NOT send presence update for passive group message');
    console.log('✓ Passive group message correctly ignored.');

    // Test 3: Direct message (DM) to bot triggers readMessages and presence
    console.log('[Test 3] Testing that private DM messages trigger readMessages and presence...');
    readKeys = [];
    presenceUpdates = [];
    mockSock = createMockSocket();

    const dmMsg: WAMessage = {
        key: {
            remoteJid: '628333333333@s.whatsapp.net',
            id: 'DM_MSG_003',
            fromMe: false
        },
        message: {
            conversation: 'Halo bot, apa kabar?'
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
    };

    await handleMessage(mockSock as WASocket, dmMsg);
    assert.strictEqual(readKeys.length, 1, 'Should call readMessages once for DM message');
    assert.strictEqual(readKeys[0].id, 'DM_MSG_003');
    assert.strictEqual(readKeys[0].remoteJid, '628333333333@s.whatsapp.net');
    assert(
        presenceUpdates.some((p) => p.type === 'available'),
        'Should send presence available on DM'
    );
    console.log('✓ Private DM message auto-read and presence verified.');

    // Test 4: Bot mentioned (@bot) in a group triggers readMessages and presence
    console.log('[Test 4] Testing that tagging the bot in a group triggers readMessages and presence...');
    readKeys = [];
    presenceUpdates = [];
    mockSock = createMockSocket();

    const mentionMsg: WAMessage = {
        key: {
            remoteJid: '1203630123456789@g.us',
            id: 'MENTION_MSG_004',
            fromMe: false,
            participant: '628444444444@s.whatsapp.net'
        },
        message: {
            extendedTextMessage: {
                text: '@628999999999 can you help me?',
                contextInfo: {
                    mentionedJid: [botJid]
                }
            }
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
    };

    await handleMessage(mockSock as WASocket, mentionMsg);
    assert.strictEqual(readKeys.length, 1, 'Should mark message as read when bot is tagged');
    assert.strictEqual(readKeys[0].id, 'MENTION_MSG_004');
    assert(
        presenceUpdates.some((p) => p.type === 'available'),
        'Should send presence available when tagged'
    );
    console.log('✓ Bot mention auto-read and presence verified.');

    // Test 5: Quoting / replying to bot in a group triggers readMessages and presence
    console.log('[Test 5] Testing that quoting/replying to the bot in a group triggers readMessages and presence...');
    readKeys = [];
    presenceUpdates = [];
    mockSock = createMockSocket();

    const quoteMsg: WAMessage = {
        key: {
            remoteJid: '1203630123456789@g.us',
            id: 'QUOTE_MSG_005',
            fromMe: false,
            participant: '628555555555@s.whatsapp.net'
        },
        message: {
            extendedTextMessage: {
                text: 'Thanks!',
                contextInfo: {
                    participant: botJid,
                    quotedMessage: {
                        conversation: 'Hello! I am Cosmos.'
                    }
                }
            }
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
    };

    await handleMessage(mockSock as WASocket, quoteMsg);
    assert.strictEqual(readKeys.length, 1, 'Should mark message as read when replying to bot');
    assert.strictEqual(readKeys[0].id, 'QUOTE_MSG_005');
    assert(
        presenceUpdates.some((p) => p.type === 'available'),
        'Should send presence available when replying to bot'
    );
    console.log('✓ Bot quote reply auto-read and presence verified.');

    // Test 6: fromMe messages do NOT trigger readMessages
    console.log('[Test 6] Testing that fromMe messages do NOT trigger readMessages...');
    readKeys = [];
    presenceUpdates = [];
    mockSock = createMockSocket();

    const selfMsg: WAMessage = {
        key: {
            remoteJid: '628111111111@s.whatsapp.net',
            id: 'SELF_MSG_006',
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

    // Test 7: Status broadcasts and newsletters do NOT trigger readMessages or presence
    console.log('[Test 7] Testing that status broadcast and newsletters are ignored...');
    readKeys = [];
    presenceUpdates = [];
    mockSock = createMockSocket();

    const statusMsg: WAMessage = {
        key: {
            remoteJid: 'status@broadcast',
            id: 'STATUS_MSG_007',
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
            id: 'NEWSLETTER_MSG_008',
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
    assert.strictEqual(presenceUpdates.length, 0, 'Should NOT send presence for status or newsletter');
    console.log('✓ Status broadcast and newsletter exclusion verified.');

    console.log('--- ALL ANTI-BOT DETECTION & AUTO-READ TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
