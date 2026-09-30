import assert from 'assert';
import { GroupMetadata, WASocket, WAMessage } from '@whiskeysockets/baileys';
import { ModerationService, resolveTargetJid } from '../src/services/moderationService.js';
import { BlacklistEnforcer } from '../src/services/blacklistEnforcer.js';
import toolsHandler from '../src/tools/handler.js';
import { prisma } from '../src/db.js';
import { getTranslator } from '../src/utils/i18n.js';

function createMockSocket(initialMetadata?: Partial<GroupMetadata>): {
    sock: WASocket;
    calls: Record<string, any[]>;
    emit: (event: string, data: any) => void;
} {
    const calls: Record<string, any[]> = {
        groupMetadata: [],
        groupParticipantsUpdate: [],
        groupSettingUpdate: [],
        groupInviteCode: [],
        groupRequestParticipantsList: [],
        groupRequestParticipantsUpdate: [],
        groupUpdateSubject: [],
        groupUpdateDescription: [],
        sendMessage: []
    };

    const listeners: Record<string, Array<(data: any) => void>> = {};

    const metadata: GroupMetadata = {
        id: '123456789@g.us',
        owner: '628111111111@s.whatsapp.net',
        subject: 'Test Group',
        subjectOwner: '628111111111@s.whatsapp.net',
        subjectTime: 0,
        creation: 0,
        desc: 'Initial Description',
        descOwner: '628111111111@s.whatsapp.net',
        descId: 'desc_001',
        restrict: false,
        announce: false,
        size: 5,
        participants: [
            { id: '6281234567890@s.whatsapp.net', admin: 'admin' }, // Bot
            { id: '628111111111@s.whatsapp.net', admin: 'superadmin' }, // Creator
            { id: '628222222222@s.whatsapp.net', admin: 'admin' }, // Admin
            { id: '628333333333@s.whatsapp.net', admin: null }, // Regular member
            { id: '628444444444@s.whatsapp.net', admin: null } // Regular member
        ],
        ...initialMetadata
    };

    const sock = {
        user: { id: '6281234567890:1@s.whatsapp.net', lid: '120300000000@lid' },
        groupMetadata: async (jid: string) => {
            calls.groupMetadata.push([jid]);
            return metadata;
        },
        groupParticipantsUpdate: async (jid: string, participants: string[], action: string) => {
            calls.groupParticipantsUpdate.push([jid, participants, action]);
            return participants.map((p) => ({ status: '200', jid: p }));
        },
        groupSettingUpdate: async (jid: string, setting: string) => {
            calls.groupSettingUpdate.push([jid, setting]);
            if (setting === 'announcement') metadata.announce = true;
            if (setting === 'not_announcement') metadata.announce = false;
        },
        groupInviteCode: async (jid: string) => {
            calls.groupInviteCode.push([jid]);
            return 'INVITE12345';
        },
        groupRequestParticipantsList: async (jid: string) => {
            calls.groupRequestParticipantsList.push([jid]);
            return [
                { jid: '628555555555@s.whatsapp.net', request_method: 'invite_link' },
                { jid: '628666666666@s.whatsapp.net', request_method: 'invite_link' }
            ];
        },
        groupRequestParticipantsUpdate: async (jid: string, participants: string[], action: string) => {
            calls.groupRequestParticipantsUpdate.push([jid, participants, action]);
            return participants.map((p) => ({ status: '200', jid: p }));
        },
        groupUpdateSubject: async (jid: string, subject: string) => {
            calls.groupUpdateSubject.push([jid, subject]);
            metadata.subject = subject;
        },
        groupUpdateDescription: async (jid: string, description: string) => {
            calls.groupUpdateDescription.push([jid, description]);
            metadata.desc = description;
        },
        sendMessage: async (jid: string, content: any) => {
            calls.sendMessage.push([jid, content]);
            return { key: { id: 'msg_test' } };
        },
        ev: {
            on: (event: string, handler: (data: any) => void) => {
                if (!listeners[event]) listeners[event] = [];
                listeners[event].push(handler);
            }
        }
    } as unknown as WASocket;

    return {
        sock,
        calls,
        emit: async (event: string, data: any) => {
            if (event === 'group-participants.update' && data.action === 'add' && Array.isArray(data.participants)) {
                for (const p of data.participants) {
                    metadata.participants.push({ id: p, admin: null });
                }
            }
            if (listeners[event]) {
                for (const handler of listeners[event]) {
                    await handler(data);
                }
            }
        }
    };
}

async function runModerationTests() {
    console.log('=== STARTING GROUP MODERATION SYSTEM TESTS ===\n');

    const groupJid = '123456789@g.us';
    const botJid = '6281234567890@s.whatsapp.net';
    const creatorJid = '628111111111@s.whatsapp.net';
    const adminJid = '628222222222@s.whatsapp.net';
    const memberJid = '628333333333@s.whatsapp.net';
    const nonMemberJid = '628999999999@s.whatsapp.net';

    // 1. Permission checks
    console.log('[Test 1] Testing permission checks (isBotAdmin, isUserAdmin, isUserMember)...');
    const { sock, calls } = createMockSocket();
    const modService = new ModerationService(sock);

    assert.strictEqual(await modService.isBotAdmin(groupJid), true, 'Bot should be identified as admin');
    assert.strictEqual(
        await modService.isUserAdmin(groupJid, creatorJid),
        true,
        'Creator should be identified as admin'
    );
    assert.strictEqual(await modService.isUserAdmin(groupJid, adminJid), true, 'Admin should be identified as admin');
    assert.strictEqual(
        await modService.isUserAdmin(groupJid, memberJid),
        false,
        'Member should not be identified as admin'
    );
    assert.strictEqual(
        await modService.isUserMember(groupJid, memberJid),
        true,
        'Member should be identified as member'
    );
    assert.strictEqual(await modService.isUserMember(groupJid, nonMemberJid), false, 'Non-member should not be member');
    console.log('✓ Permission checks passed.');

    // 2. Kick member validation
    console.log('[Test 2] Testing kickMember constraints...');
    ModerationService.clearRateLimits();

    // 2a. Cannot kick self
    const kickSelfRes = await modService.kickMember(groupJid, botJid, 'Self test', adminJid);
    assert.strictEqual(kickSelfRes.success, false);
    assert.strictEqual(kickSelfRes.message, 'TARGET_IS_SELF');

    // 2b. Cannot kick admin
    ModerationService.clearRateLimits();
    const kickAdminRes = await modService.kickMember(groupJid, adminJid, 'Admin test', creatorJid);
    assert.strictEqual(kickAdminRes.success, false);
    assert.strictEqual(kickAdminRes.message, 'TARGET_IS_ADMIN');

    // 2c. Cannot kick non-member
    ModerationService.clearRateLimits();
    const kickNonMemberRes = await modService.kickMember(groupJid, nonMemberJid, 'Non-member test', adminJid);
    assert.strictEqual(kickNonMemberRes.success, false);
    assert.strictEqual(kickNonMemberRes.message, 'TARGET_NOT_MEMBER');

    // 2d. Successfully kicks regular member
    ModerationService.clearRateLimits();
    const kickMemberRes = await modService.kickMember(groupJid, memberJid, 'Spamming', adminJid);
    assert.strictEqual(kickMemberRes.success, true);
    assert.strictEqual(kickMemberRes.message, 'KICK_SUCCESS');
    assert.strictEqual(calls.groupParticipantsUpdate.length, 1);
    assert.strictEqual(calls.groupParticipantsUpdate[0][2], 'remove');
    console.log('✓ kickMember constraints passed.');

    // 3. Promote & Demote Admin
    console.log('[Test 3] Testing promoteAdmin & demoteAdmin...');
    ModerationService.clearRateLimits();

    // 3a. Promote regular member
    const promoteRes = await modService.promoteAdmin(groupJid, '628444444444@s.whatsapp.net', adminJid);
    assert.strictEqual(promoteRes.success, true);
    assert.strictEqual(promoteRes.message, 'PROMOTE_SUCCESS');

    // 3b. Promote already admin
    ModerationService.clearRateLimits();
    const promoteAlreadyRes = await modService.promoteAdmin(groupJid, adminJid, creatorJid);
    assert.strictEqual(promoteAlreadyRes.success, false);
    assert.strictEqual(promoteAlreadyRes.message, 'ALREADY_ADMIN');

    // 3c. Demote creator rejected
    ModerationService.clearRateLimits();
    const demoteCreatorRes = await modService.demoteAdmin(groupJid, creatorJid, adminJid);
    assert.strictEqual(demoteCreatorRes.success, false);
    assert.strictEqual(demoteCreatorRes.message, 'TARGET_IS_CREATOR');

    // 3d. Demote admin succeeded
    ModerationService.clearRateLimits();
    const demoteAdminRes = await modService.demoteAdmin(groupJid, adminJid, creatorJid);
    assert.strictEqual(demoteAdminRes.success, true);
    assert.strictEqual(demoteAdminRes.message, 'DEMOTE_SUCCESS');
    console.log('✓ promoteAdmin & demoteAdmin passed.');

    // 4. Close & Open Group
    console.log('[Test 4] Testing setGroupAnnounce (close/open)...');
    ModerationService.clearRateLimits();
    const closeRes = await modService.setGroupAnnounce(groupJid, true, adminJid);
    assert.strictEqual(closeRes.success, true);
    assert.strictEqual(closeRes.message, 'CLOSE_SUCCESS');

    // Already closed
    ModerationService.clearRateLimits();
    const closeAgainRes = await modService.setGroupAnnounce(groupJid, true, adminJid);
    assert.strictEqual(closeAgainRes.success, false);
    assert.strictEqual(closeAgainRes.message, 'ALREADY_CLOSED');

    // Open group
    ModerationService.clearRateLimits();
    const openRes = await modService.setGroupAnnounce(groupJid, false, adminJid);
    assert.strictEqual(openRes.success, true);
    assert.strictEqual(openRes.message, 'OPEN_SUCCESS');

    // Already open
    ModerationService.clearRateLimits();
    const openAgainRes = await modService.setGroupAnnounce(groupJid, false, adminJid);
    assert.strictEqual(openAgainRes.success, false);
    assert.strictEqual(openAgainRes.message, 'ALREADY_OPEN');
    console.log('✓ setGroupAnnounce passed.');

    // 5. Group Rename & Description Validation
    console.log('[Test 5] Testing group rename & description length boundaries...');
    ModerationService.clearRateLimits();
    const renameShort = await modService.updateGroupSubject(groupJid, '', adminJid);
    assert.strictEqual(renameShort.success, false);
    assert.strictEqual(renameShort.message, 'TOO_SHORT');

    const renameLong = await modService.updateGroupSubject(groupJid, 'A'.repeat(26), adminJid);
    assert.strictEqual(renameLong.success, false);
    assert.strictEqual(renameLong.message, 'TOO_LONG');

    ModerationService.clearRateLimits();
    const renameValid = await modService.updateGroupSubject(groupJid, 'Cosmos Official', adminJid);
    assert.strictEqual(renameValid.success, true);
    assert.strictEqual(renameValid.data?.name, 'Cosmos Official');

    ModerationService.clearRateLimits();
    const descShort = await modService.updateGroupDescription(groupJid, '   ', adminJid);
    assert.strictEqual(descShort.success, false);
    assert.strictEqual(descShort.message, 'EMPTY');

    const descLong = await modService.updateGroupDescription(groupJid, 'B'.repeat(513), adminJid);
    assert.strictEqual(descLong.success, false);
    assert.strictEqual(descLong.message, 'TOO_LONG');

    ModerationService.clearRateLimits();
    const descValid = await modService.updateGroupDescription(groupJid, 'Welcome to the Cosmos chat!', adminJid);
    assert.strictEqual(descValid.success, true);
    console.log('✓ Rename & description validation passed.');

    // 6. Rate Limiting Cooldown
    console.log('[Test 6] Testing 3-second rate limiting cooldown...');
    ModerationService.clearRateLimits();
    const firstAction = await modService.updateGroupSubject(groupJid, 'Rate Limit Test', adminJid);
    assert.strictEqual(firstAction.success, true);

    const secondAction = await modService.updateGroupSubject(groupJid, 'Rate Limit Test 2', adminJid);
    assert.strictEqual(secondAction.success, false);
    assert.strictEqual(secondAction.message, 'RATE_LIMIT_EXCEEDED');
    console.log('✓ Rate limiting cooldown verified.');

    // 7. Invite Member via DM
    console.log('[Test 7] Testing inviteMember via DM...');
    ModerationService.clearRateLimits();
    const inviteRes = await modService.inviteMember(groupJid, '628777777777', 'Admin Alice', adminJid);
    assert.strictEqual(inviteRes.success, true);
    assert.strictEqual(inviteRes.message, 'INVITE_SUCCESS');
    assert.strictEqual(inviteRes.data?.phone, '628777777777');
    assert.strictEqual(inviteRes.data?.inviteLink, 'https://chat.whatsapp.com/INVITE12345');
    // Verify DM was sent to the target user
    const sentDm = calls.sendMessage.find((c) => c[0] === '628777777777@s.whatsapp.net');
    assert.ok(sentDm, 'DM should have been sent to target phone');
    assert.ok(sentDm[1].text.includes('Admin Alice'), 'DM text should include inviter pushname');
    assert.ok(sentDm[1].text.includes('https://chat.whatsapp.com/INVITE12345'), 'DM text should include invite link');
    console.log('✓ inviteMember via DM verified.');

    // 8. Join Requests (Single & All)
    console.log('[Test 8] Testing approveJoinRequest & rejectJoinRequest...');
    ModerationService.clearRateLimits();
    const approveRes = await modService.approveJoinRequest(groupJid, '628555555555@s.whatsapp.net', adminJid);
    assert.strictEqual(approveRes.success, true);
    assert.strictEqual(approveRes.message, 'APPROVE_SUCCESS');

    ModerationService.clearRateLimits();
    const rejectRes = await modService.rejectJoinRequest(groupJid, '628666666666@s.whatsapp.net', adminJid);
    assert.strictEqual(rejectRes.success, true);
    assert.strictEqual(rejectRes.message, 'REJECT_SUCCESS');
    console.log('✓ Join request actions verified.');

    // 9. Blacklist System (Add, IsBlacklisted, Remove, List)
    console.log('[Test 9] Testing Blacklist system...');
    // Clean up test blacklist entries first
    await prisma.groupBlacklist.deleteMany({ where: { groupJid } });

    const targetBlJid = '628888888888@s.whatsapp.net';
    assert.strictEqual(await modService.isBlacklisted(groupJid, targetBlJid), false);

    const addBlRes = await modService.addToBlacklist(groupJid, targetBlJid, 'Toxic behavior', adminJid);
    assert.strictEqual(addBlRes.success, true);
    assert.strictEqual(addBlRes.message, 'BLACKLIST_ADDED');

    // Duplicate add rejected
    const addBlAgain = await modService.addToBlacklist(groupJid, targetBlJid, 'Another reason', adminJid);
    assert.strictEqual(addBlAgain.success, false);
    assert.strictEqual(addBlAgain.message, 'ALREADY_BLACKLISTED');

    // Check blacklist status
    assert.strictEqual(await modService.isBlacklisted(groupJid, targetBlJid), true);
    // LID or clean phone should also match
    assert.strictEqual(await modService.isBlacklisted(groupJid, '628888888888@lid'), true);
    assert.strictEqual(await modService.isBlacklisted(groupJid, '628888888888'), true);

    // List blacklist
    const listRes = await modService.getBlacklist(groupJid);
    assert.strictEqual(listRes.success, true);
    assert.strictEqual(listRes.data?.entries.length, 1);

    // Remove blacklist
    const removeRes = await modService.removeFromBlacklist(groupJid, targetBlJid, adminJid);
    assert.strictEqual(removeRes.success, true);
    assert.strictEqual(removeRes.message, 'BLACKLIST_REMOVED');
    assert.strictEqual(await modService.isBlacklisted(groupJid, targetBlJid), false);
    console.log('✓ Blacklist operations verified.');

    // 10. Blacklist Enforcer Auto-Kick
    console.log('[Test 10] Testing BlacklistEnforcer event handling...');
    const enforcerMock = createMockSocket();
    const enforcerModService = new ModerationService(enforcerMock.sock);
    const enforcer = new BlacklistEnforcer(enforcerMock.sock, enforcerModService);
    enforcer.startListening();

    // Add target to blacklist
    await enforcerModService.addToBlacklist(groupJid, '628999111222@s.whatsapp.net', 'Auto-kick test', 'admin');

    // Emit group-participants.update event with blacklisted participant and await handling
    await enforcerMock.emit('group-participants.update', {
        id: groupJid,
        participants: ['628999111222@s.whatsapp.net'],
        action: 'add'
    });

    // Verify kick was called
    const kickCalls = enforcerMock.calls.groupParticipantsUpdate.filter(
        (c) => c[1].includes('628999111222@s.whatsapp.net') && c[2] === 'remove'
    );
    assert.ok(kickCalls.length >= 1, 'Enforcer should have auto-kicked the blacklisted user');

    // Verify notification was sent
    const notifyCalls = enforcerMock.calls.sendMessage.filter(
        (c) => c[0] === groupJid && c[1].text.includes('automatically removed because they are blacklisted')
    );
    assert.ok(notifyCalls.length >= 1, 'Enforcer should have notified the group');
    console.log('✓ BlacklistEnforcer auto-kick verified.');

    // 11. Target JID Resolver
    console.log('[Test 11] Testing resolveTargetJid utility...');
    const msgWithMention = {
        message: {
            extendedTextMessage: {
                contextInfo: {
                    mentionedJid: ['628123000111@s.whatsapp.net']
                }
            }
        }
    } as unknown as WAMessage;
    assert.strictEqual(resolveTargetJid(msgWithMention), '628123000111@s.whatsapp.net');

    const msgWithQuote = {
        message: {
            extendedTextMessage: {
                contextInfo: {
                    participant: '628123000222@s.whatsapp.net'
                }
            }
        }
    } as unknown as WAMessage;
    assert.strictEqual(resolveTargetJid(msgWithQuote), '628123000222@s.whatsapp.net');

    const msgEmpty = {} as WAMessage;
    assert.strictEqual(resolveTargetJid(msgEmpty, '+62 812-3000-333'), '628123000333@s.whatsapp.net');
    console.log('✓ resolveTargetJid verified.');

    // 12. Tools and Spaced Command Registration
    console.log('[Test 12] Testing ToolsHandler registration & localization strings...');
    await toolsHandler.loadTools();
    const tEn = getTranslator('en');
    const tId = getTranslator('id');

    const allCommands = [
        'group kick',
        'group close',
        'group open',
        'group invite',
        'group link',
        'group approve',
        'group reject',
        'group promote',
        'group demote',
        'group rename',
        'group description',
        'group blacklist add',
        'group blacklist remove',
        'group blacklist list'
    ];

    for (const cmd of allCommands) {
        const tool = toolsHandler.getTool(cmd);
        assert.ok(tool, `Tool ${cmd} should be registered in ToolsHandler`);
        assert.strictEqual(tool.definition.category, 'Moderation');
        assert.ok(tool.definition.name.includes(' '), 'Command name must contain a space');
        assert.ok(tool.definition.displayNames?.en, 'Tool must have en displayName');
        assert.ok(tool.definition.displayNames?.id, 'Tool must have id displayName');
        assert.ok(tool.definition.descriptionKey, 'Tool must have descriptionKey');

        // Check i18n
        const enDesc = tEn(tool.definition.descriptionKey);
        const idDesc = tId(tool.definition.descriptionKey);
        assert.notStrictEqual(
            enDesc,
            tool.definition.descriptionKey,
            `en translation missing for ${tool.definition.descriptionKey}`
        );
        assert.notStrictEqual(
            idDesc,
            tool.definition.descriptionKey,
            `id translation missing for ${tool.definition.descriptionKey}`
        );
    }
    console.log('✓ All 14 moderation tools and localization keys verified.');

    // Cleanup
    await prisma.groupBlacklist.deleteMany({ where: { groupJid } });
    await prisma.moderationLog.deleteMany({ where: { groupJid } });

    console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
}

runModerationTests()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Test failed with error:', err);
        process.exit(1);
    });
