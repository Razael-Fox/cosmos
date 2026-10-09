import { GroupMetadata, WASocket, WAMessage } from '@whiskeysockets/baileys';
import { prisma } from '../db.js';
import { cleanId, formatMentions } from '../lib/casino.js';
import { isOwnerId } from '../lib/owner.js';

export interface ModerationAction {
    action: 'kick' | 'promote' | 'demote' | 'close' | 'open' | 'invite' | 'approve' | 'reject';
    targetJid?: string;
    targetPhone?: string;
    reason?: string;
}

export interface ModerationResult {
    success: boolean;
    message: string;
    data?: Record<string, unknown>;
}
type GroupParticipant = GroupMetadata['participants'][number];

export function getParticipantLid(p: GroupParticipant): string | null {
    if ('lid' in p && typeof p.lid === 'string') {
        return cleanId(p.lid);
    }
    return null;
}

export class ModerationService {
    private static rateLimiter: Map<string, number> = new Map();
    public static RATE_LIMIT_MS = 3000;

    constructor(private sock: WASocket) {}

    public static clearRateLimits(): void {
        ModerationService.rateLimiter.clear();
    }

    public static clearRateLimit(groupJid: string): void {
        ModerationService.rateLimiter.delete(groupJid);
    }

    private checkRateLimit(groupJid: string): boolean {
        const now = Date.now();
        const lastAction = ModerationService.rateLimiter.get(groupJid) || 0;
        if (now - lastAction < ModerationService.RATE_LIMIT_MS) {
            return false;
        }
        ModerationService.rateLimiter.set(groupJid, now);
        return true;
    }

    private async logModeration(
        groupJid: string,
        action: string,
        targetJid: string | null | undefined,
        targetPhone: string | null | undefined,
        reason: string | null | undefined,
        performedBy: string,
        success: boolean,
        error?: string | null
    ): Promise<void> {
        try {
            await prisma.moderationLog.create({
                data: {
                    groupJid,
                    action,
                    targetJid: targetJid || null,
                    targetPhone: targetPhone || null,
                    reason: reason || null,
                    performedBy: performedBy || 'SYSTEM',
                    performedAt: new Date(),
                    success,
                    error: error || null
                }
            });
        } catch (err) {
            console.error('[ModerationService] Failed to record ModerationLog:', err);
        }
    }

    // Permission checks
    public async isBotAdmin(groupJid: string): Promise<boolean> {
        try {
            const metadata = await this.sock.groupMetadata(groupJid);
            const botJid = cleanId(this.sock.user?.id);
            const botLid = cleanId((this.sock.user as Record<string, unknown> | undefined)?.lid as string | undefined);

            const botParticipant = metadata.participants.find((p) => {
                const pClean = cleanId(p.id);
                const pLidClean = getParticipantLid(p);
                return pClean === botJid || (Boolean(botLid) && (pClean === botLid || pLidClean === botLid));
            });

            return botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';
        } catch (err) {
            console.error(`[ModerationService] Error checking bot admin status for ${groupJid}:`, err);
            return false;
        }
    }

    public async isUserAdmin(groupJid: string, userJid: string): Promise<boolean> {
        if (!userJid) return false;
        if (isOwnerId(userJid)) return true;

        try {
            const metadata = await this.sock.groupMetadata(groupJid);
            const cleanedUser = cleanId(userJid);

            if (metadata.owner && cleanId(metadata.owner) === cleanedUser) {
                return true;
            }

            const participant = metadata.participants.find((p) => {
                const pClean = cleanId(p.id);
                const pLidClean = getParticipantLid(p);
                return pClean === cleanedUser || pLidClean === cleanedUser;
            });

            return participant?.admin === 'admin' || participant?.admin === 'superadmin';
        } catch (err) {
            console.error(`[ModerationService] Error checking user admin status for ${userJid}:`, err);
            return false;
        }
    }

    public async isUserMember(groupJid: string, userJid: string): Promise<boolean> {
        if (!userJid) return false;
        try {
            const metadata = await this.sock.groupMetadata(groupJid);
            const cleanedUser = cleanId(userJid);

            return metadata.participants.some((p) => {
                const pClean = cleanId(p.id);
                const pLidClean = getParticipantLid(p);
                return pClean === cleanedUser || pLidClean === cleanedUser;
            });
        } catch {
            return false;
        }
    }

    public isSelf(targetJid: string): boolean {
        const cleanedTarget = cleanId(targetJid);
        const botJid = cleanId(this.sock.user?.id);
        const botLid = cleanId((this.sock.user as Record<string, unknown> | undefined)?.lid as string | undefined);
        return cleanedTarget === botJid || (Boolean(botLid) && cleanedTarget === botLid);
    }

    // Core actions
    public async kickMember(
        groupJid: string,
        targetJid: string,
        reason?: string,
        performedBy = 'SYSTEM'
    ): Promise<ModerationResult> {
        if (this.isSelf(targetJid)) {
            return { success: false, message: 'TARGET_IS_SELF' };
        }

        const isSystem = performedBy === 'SYSTEM';
        if (!isSystem && !this.checkRateLimit(groupJid)) {
            return { success: false, message: 'RATE_LIMIT_EXCEEDED' };
        }

        let metadata: GroupMetadata;
        try {
            metadata = await this.sock.groupMetadata(groupJid);
        } catch (err) {
            return { success: false, message: 'FETCH_METADATA_FAILED', data: { error: String(err) } };
        }

        const botJid = cleanId(this.sock.user?.id);
        const botLid = cleanId((this.sock.user as Record<string, unknown> | undefined)?.lid as string | undefined);
        const botParticipant = metadata.participants.find((p) => {
            const pClean = cleanId(p.id);
            const pLidClean = getParticipantLid(p);
            return pClean === botJid || (Boolean(botLid) && (pClean === botLid || pLidClean === botLid));
        });

        if (botParticipant?.admin !== 'admin' && botParticipant?.admin !== 'superadmin') {
            await this.logModeration(
                groupJid,
                'kick',
                targetJid,
                cleanId(targetJid),
                reason,
                performedBy,
                false,
                'BOT_NOT_ADMIN'
            );
            return { success: false, message: 'BOT_NOT_ADMIN' };
        }

        const cleanedTarget = cleanId(targetJid);
        const targetParticipant = metadata.participants.find((p) => {
            const pClean = cleanId(p.id);
            const pLidClean = getParticipantLid(p);
            return pClean === cleanedTarget || pLidClean === cleanedTarget;
        });

        if (!targetParticipant) {
            return { success: false, message: 'TARGET_NOT_MEMBER' };
        }

        if (targetParticipant.admin === 'admin' || targetParticipant.admin === 'superadmin') {
            await this.logModeration(
                groupJid,
                'kick',
                targetJid,
                cleanId(targetJid),
                reason,
                performedBy,
                false,
                'TARGET_IS_ADMIN'
            );
            return { success: false, message: 'TARGET_IS_ADMIN' };
        }

        try {
            const res = await this.sock.groupParticipantsUpdate(groupJid, [targetParticipant.id], 'remove');
            const status = Array.isArray(res) && res[0]?.status ? String(res[0].status) : 'UNKNOWN';
            if (status !== '200') {
                await this.logModeration(
                    groupJid,
                    'kick',
                    targetParticipant.id,
                    cleanId(targetParticipant.id),
                    reason,
                    performedBy,
                    false,
                    `STATUS_${status}`
                );
                return { success: false, message: 'KICK_FAILED', data: { status } };
            }
            await this.logModeration(
                groupJid,
                'kick',
                targetParticipant.id,
                cleanId(targetParticipant.id),
                reason,
                performedBy,
                true
            );
            return { success: true, message: 'KICK_SUCCESS', data: { targetJid: targetParticipant.id, status } };
        } catch (err) {
            await this.logModeration(
                groupJid,
                'kick',
                targetJid,
                cleanId(targetJid),
                reason,
                performedBy,
                false,
                String(err)
            );
            return { success: false, message: 'KICK_FAILED', data: { error: String(err) } };
        }
    }

    public async promoteAdmin(groupJid: string, targetJid: string, performedBy = 'SYSTEM'): Promise<ModerationResult> {
        if (!this.checkRateLimit(groupJid)) {
            return { success: false, message: 'RATE_LIMIT_EXCEEDED' };
        }

        let metadata: GroupMetadata;
        try {
            metadata = await this.sock.groupMetadata(groupJid);
        } catch (err) {
            return { success: false, message: 'FETCH_METADATA_FAILED', data: { error: String(err) } };
        }

        const isBotAdm = await this.isBotAdmin(groupJid);
        if (!isBotAdm) {
            await this.logModeration(
                groupJid,
                'promote',
                targetJid,
                cleanId(targetJid),
                null,
                performedBy,
                false,
                'BOT_NOT_ADMIN'
            );
            return { success: false, message: 'BOT_NOT_ADMIN' };
        }

        const cleanedTarget = cleanId(targetJid);
        const targetParticipant = metadata.participants.find((p) => {
            const pClean = cleanId(p.id);
            const pLidClean = getParticipantLid(p);
            return pClean === cleanedTarget || pLidClean === cleanedTarget;
        });

        if (!targetParticipant) {
            return { success: false, message: 'TARGET_NOT_MEMBER' };
        }

        if (targetParticipant.admin === 'admin' || targetParticipant.admin === 'superadmin') {
            return { success: false, message: 'ALREADY_ADMIN' };
        }

        try {
            const res = await this.sock.groupParticipantsUpdate(groupJid, [targetParticipant.id], 'promote');
            const status = Array.isArray(res) && res[0]?.status ? String(res[0].status) : 'UNKNOWN';
            if (status !== '200') {
                await this.logModeration(
                    groupJid,
                    'promote',
                    targetParticipant.id,
                    cleanId(targetParticipant.id),
                    null,
                    performedBy,
                    false,
                    `STATUS_${status}`
                );
                return { success: false, message: 'PROMOTE_FAILED', data: { status } };
            }
            await this.logModeration(
                groupJid,
                'promote',
                targetParticipant.id,
                cleanId(targetParticipant.id),
                null,
                performedBy,
                true
            );
            return { success: true, message: 'PROMOTE_SUCCESS', data: { targetJid: targetParticipant.id, status } };
        } catch (err) {
            await this.logModeration(
                groupJid,
                'promote',
                targetJid,
                cleanId(targetJid),
                null,
                performedBy,
                false,
                String(err)
            );
            return { success: false, message: 'PROMOTE_FAILED', data: { error: String(err) } };
        }
    }

    public async demoteAdmin(groupJid: string, targetJid: string, performedBy = 'SYSTEM'): Promise<ModerationResult> {
        if (!this.checkRateLimit(groupJid)) {
            return { success: false, message: 'RATE_LIMIT_EXCEEDED' };
        }

        let metadata: GroupMetadata;
        try {
            metadata = await this.sock.groupMetadata(groupJid);
        } catch (err) {
            return { success: false, message: 'FETCH_METADATA_FAILED', data: { error: String(err) } };
        }

        const isBotAdm = await this.isBotAdmin(groupJid);
        if (!isBotAdm) {
            await this.logModeration(
                groupJid,
                'demote',
                targetJid,
                cleanId(targetJid),
                null,
                performedBy,
                false,
                'BOT_NOT_ADMIN'
            );
            return { success: false, message: 'BOT_NOT_ADMIN' };
        }

        const cleanedTarget = cleanId(targetJid);
        const targetParticipant = metadata.participants.find((p) => {
            const pClean = cleanId(p.id);
            const pLidClean = getParticipantLid(p);
            return pClean === cleanedTarget || pLidClean === cleanedTarget;
        });

        if (!targetParticipant || (targetParticipant.admin !== 'admin' && targetParticipant.admin !== 'superadmin')) {
            return { success: false, message: 'NOT_ADMIN' };
        }

        const isCreator =
            (metadata.owner && cleanId(metadata.owner) === cleanedTarget) || targetParticipant.admin === 'superadmin';

        if (isCreator) {
            await this.logModeration(
                groupJid,
                'demote',
                targetJid,
                cleanId(targetJid),
                null,
                performedBy,
                false,
                'TARGET_IS_CREATOR'
            );
            return { success: false, message: 'TARGET_IS_CREATOR' };
        }

        try {
            const res = await this.sock.groupParticipantsUpdate(groupJid, [targetParticipant.id], 'demote');
            const status = Array.isArray(res) && res[0]?.status ? String(res[0].status) : 'UNKNOWN';
            if (status !== '200') {
                await this.logModeration(
                    groupJid,
                    'demote',
                    targetParticipant.id,
                    cleanId(targetParticipant.id),
                    null,
                    performedBy,
                    false,
                    `STATUS_${status}`
                );
                return { success: false, message: 'DEMOTE_FAILED', data: { status } };
            }
            await this.logModeration(
                groupJid,
                'demote',
                targetParticipant.id,
                cleanId(targetParticipant.id),
                null,
                performedBy,
                true
            );
            return { success: true, message: 'DEMOTE_SUCCESS', data: { targetJid: targetParticipant.id, status } };
        } catch (err) {
            await this.logModeration(
                groupJid,
                'demote',
                targetJid,
                cleanId(targetJid),
                null,
                performedBy,
                false,
                String(err)
            );
            return { success: false, message: 'DEMOTE_FAILED', data: { error: String(err) } };
        }
    }

    public async setGroupAnnounce(
        groupJid: string,
        announce: boolean,
        performedBy = 'SYSTEM'
    ): Promise<ModerationResult> {
        if (!this.checkRateLimit(groupJid)) {
            return { success: false, message: 'RATE_LIMIT_EXCEEDED' };
        }

        let metadata: GroupMetadata;
        try {
            metadata = await this.sock.groupMetadata(groupJid);
        } catch (err) {
            return { success: false, message: 'FETCH_METADATA_FAILED', data: { error: String(err) } };
        }

        const isBotAdm = await this.isBotAdmin(groupJid);
        if (!isBotAdm) {
            await this.logModeration(
                groupJid,
                announce ? 'close' : 'open',
                null,
                null,
                null,
                performedBy,
                false,
                'BOT_NOT_ADMIN'
            );
            return { success: false, message: 'BOT_NOT_ADMIN' };
        }

        if (metadata.announce === announce) {
            return { success: false, message: announce ? 'ALREADY_CLOSED' : 'ALREADY_OPEN' };
        }

        try {
            await this.sock.groupSettingUpdate(groupJid, announce ? 'announcement' : 'not_announcement');
            await this.logModeration(groupJid, announce ? 'close' : 'open', null, null, null, performedBy, true);
            return { success: true, message: announce ? 'CLOSE_SUCCESS' : 'OPEN_SUCCESS' };
        } catch (err) {
            await this.logModeration(
                groupJid,
                announce ? 'close' : 'open',
                null,
                null,
                null,
                performedBy,
                false,
                String(err)
            );
            return { success: false, message: 'SETTING_UPDATE_FAILED', data: { error: String(err) } };
        }
    }

    public async inviteMember(
        groupJid: string,
        phone: string,
        inviterName: string,
        inviterJid: string,
        t?: (key: string, vars?: Record<string, unknown>) => string
    ): Promise<ModerationResult> {
        if (!this.checkRateLimit(groupJid)) {
            return { success: false, message: 'RATE_LIMIT_EXCEEDED' };
        }

        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length < 8 || cleanPhone.length > 15) {
            return { success: false, message: 'INVALID_PHONE' };
        }

        let metadata: GroupMetadata;
        try {
            metadata = await this.sock.groupMetadata(groupJid);
        } catch (err) {
            return { success: false, message: 'FETCH_METADATA_FAILED', data: { error: String(err) } };
        }

        const isBotAdm = await this.isBotAdmin(groupJid);
        if (!isBotAdm) {
            await this.logModeration(groupJid, 'invite', null, cleanPhone, null, inviterJid, false, 'BOT_NOT_ADMIN');
            return { success: false, message: 'BOT_NOT_ADMIN' };
        }

        const isMember = metadata.participants.some((p) => {
            const pClean = cleanId(p.id);
            const pLidClean = getParticipantLid(p);
            return pClean === cleanPhone || pLidClean === cleanPhone;
        });

        if (isMember) {
            return { success: false, message: 'ALREADY_MEMBER' };
        }

        let inviteCode: string | undefined;
        try {
            inviteCode = await this.sock.groupInviteCode(groupJid);
        } catch (err) {
            return { success: false, message: 'INVITE_CODE_FAILED', data: { error: String(err) } };
        }

        if (!inviteCode) {
            return { success: false, message: 'INVITE_CODE_FAILED' };
        }

        const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
        const groupName = metadata.subject || 'Group';
        const memberCount = metadata.participants.length;

        const defaultDmMessage =
            `*📋 GROUP INVITATION*\n\n` +
            `> 👋 Hello!\n` +
            `> *${inviterName}* invites you to join the group.\n\n` +
            `- 📋 *Group Name:* ${groupName}\n` +
            `- 👥 *Members:* ${memberCount}\n\n` +
            `> 🔗 *Invite Link:*\n` +
            `> ${inviteLink}\n\n` +
            `> ℹ️ This invitation was sent by a group admin. You can choose to accept or ignore this invitation.`;

        const messageText =
            typeof t === 'function'
                ? t('tools.group_invite.dm_message', {
                      userDisplay: inviterName,
                      groupName,
                      memberCount,
                      inviteLink
                  })
                : defaultDmMessage;

        try {
            const targetDmJid = `${cleanPhone}@s.whatsapp.net`;
            await this.sock.sendMessage(targetDmJid, { text: messageText });
            await this.logModeration(
                groupJid,
                'invite',
                targetDmJid,
                cleanPhone,
                `Invited by ${inviterName}`,
                inviterJid,
                true
            );
            return { success: true, message: 'INVITE_SUCCESS', data: { phone: cleanPhone, inviteLink } };
        } catch (err) {
            await this.logModeration(groupJid, 'invite', null, cleanPhone, null, inviterJid, false, String(err));
            return { success: false, message: 'DM_FAILED', data: { error: String(err) } };
        }
    }

    public async getGroupLink(groupJid: string, _performedBy = 'SYSTEM'): Promise<ModerationResult> {
        const isBotAdm = await this.isBotAdmin(groupJid);
        if (!isBotAdm) {
            return { success: false, message: 'BOT_NOT_ADMIN' };
        }

        try {
            const inviteCode = await this.sock.groupInviteCode(groupJid);
            if (!inviteCode) {
                return { success: false, message: 'INVITE_CODE_FAILED' };
            }
            const link = `https://chat.whatsapp.com/${inviteCode}`;
            return { success: true, message: 'LINK_SUCCESS', data: { link, inviteCode } };
        } catch (err) {
            return { success: false, message: 'LINK_FAILED', data: { error: String(err) } };
        }
    }

    public async getPendingJoinRequests(groupJid: string): Promise<Array<{ jid?: string; [key: string]: unknown }>> {
        try {
            return await this.sock.groupRequestParticipantsList(groupJid);
        } catch (err) {
            console.error(`[ModerationService] Error fetching pending join requests for ${groupJid}:`, err);
            return [];
        }
    }

    public async approveJoinRequest(
        groupJid: string,
        targetJid: string,
        performedBy = 'SYSTEM'
    ): Promise<ModerationResult> {
        if (!this.checkRateLimit(groupJid)) {
            return { success: false, message: 'RATE_LIMIT_EXCEEDED' };
        }

        const isBotAdm = await this.isBotAdmin(groupJid);
        if (!isBotAdm) {
            await this.logModeration(
                groupJid,
                'approve',
                targetJid,
                cleanId(targetJid),
                null,
                performedBy,
                false,
                'BOT_NOT_ADMIN'
            );
            return { success: false, message: 'BOT_NOT_ADMIN' };
        }

        try {
            const res = await this.sock.groupRequestParticipantsUpdate(groupJid, [targetJid], 'approve');
            const status = Array.isArray(res) && res[0]?.status ? String(res[0].status) : 'UNKNOWN';
            if (status !== '200') {
                await this.logModeration(
                    groupJid,
                    'approve',
                    targetJid,
                    cleanId(targetJid),
                    null,
                    performedBy,
                    false,
                    `STATUS_${status}`
                );
                return { success: false, message: 'APPROVE_FAILED', data: { status } };
            }
            await this.logModeration(groupJid, 'approve', targetJid, cleanId(targetJid), null, performedBy, true);
            return { success: true, message: 'APPROVE_SUCCESS', data: { targetJid, status } };
        } catch (err) {
            await this.logModeration(
                groupJid,
                'approve',
                targetJid,
                cleanId(targetJid),
                null,
                performedBy,
                false,
                String(err)
            );
            return { success: false, message: 'APPROVE_FAILED', data: { error: String(err) } };
        }
    }

    public async approveAllJoinRequests(
        groupJid: string,
        performedBy = 'SYSTEM'
    ): Promise<{ count: number; error?: string }> {
        const isBotAdm = await this.isBotAdmin(groupJid);
        if (!isBotAdm) {
            return { count: 0, error: 'BOT_NOT_ADMIN' };
        }

        const pending = await this.getPendingJoinRequests(groupJid);
        if (!pending || pending.length === 0) {
            return { count: 0 };
        }

        let approvedCount = 0;
        for (let i = 0; i < pending.length; i++) {
            const req = pending[i];
            const jid = req?.jid;
            if (!jid) continue;

            if (i > 0) {
                await new Promise((resolve) => setTimeout(resolve, ModerationService.RATE_LIMIT_MS));
            }

            try {
                const res = await this.sock.groupRequestParticipantsUpdate(groupJid, [jid], 'approve');
                const status = Array.isArray(res) && res[0]?.status ? String(res[0].status) : 'UNKNOWN';
                if (status === '200') {
                    approvedCount++;
                    await this.logModeration(
                        groupJid,
                        'approve',
                        jid,
                        cleanId(jid),
                        'Bulk approval',
                        performedBy,
                        true
                    );
                } else {
                    await this.logModeration(
                        groupJid,
                        'approve',
                        jid,
                        cleanId(jid),
                        'Bulk approval failed',
                        performedBy,
                        false,
                        `STATUS_${status}`
                    );
                }
            } catch (err) {
                console.error(`[ModerationService] Error approving request for ${jid}:`, err);
                await this.logModeration(
                    groupJid,
                    'approve',
                    jid,
                    cleanId(jid),
                    'Bulk approval error',
                    performedBy,
                    false,
                    String(err)
                );
            }
        }

        return { count: approvedCount };
    }

    public async rejectJoinRequest(
        groupJid: string,
        targetJid: string,
        performedBy = 'SYSTEM'
    ): Promise<ModerationResult> {
        if (!this.checkRateLimit(groupJid)) {
            return { success: false, message: 'RATE_LIMIT_EXCEEDED' };
        }

        const isBotAdm = await this.isBotAdmin(groupJid);
        if (!isBotAdm) {
            await this.logModeration(
                groupJid,
                'reject',
                targetJid,
                cleanId(targetJid),
                null,
                performedBy,
                false,
                'BOT_NOT_ADMIN'
            );
            return { success: false, message: 'BOT_NOT_ADMIN' };
        }

        try {
            const res = await this.sock.groupRequestParticipantsUpdate(groupJid, [targetJid], 'reject');
            const status = Array.isArray(res) && res[0]?.status ? String(res[0].status) : 'UNKNOWN';
            if (status !== '200') {
                await this.logModeration(
                    groupJid,
                    'reject',
                    targetJid,
                    cleanId(targetJid),
                    null,
                    performedBy,
                    false,
                    `STATUS_${status}`
                );
                return { success: false, message: 'REJECT_FAILED', data: { status } };
            }
            await this.logModeration(groupJid, 'reject', targetJid, cleanId(targetJid), null, performedBy, true);
            return { success: true, message: 'REJECT_SUCCESS', data: { targetJid, status } };
        } catch (err) {
            await this.logModeration(
                groupJid,
                'reject',
                targetJid,
                cleanId(targetJid),
                null,
                performedBy,
                false,
                String(err)
            );
            return { success: false, message: 'REJECT_FAILED', data: { error: String(err) } };
        }
    }

    public async updateGroupSubject(
        groupJid: string,
        subject: string,
        performedBy = 'SYSTEM'
    ): Promise<ModerationResult> {
        const trimmed = subject.trim();
        if (trimmed.length < 1) {
            return { success: false, message: 'TOO_SHORT' };
        }
        if (trimmed.length > 25) {
            return { success: false, message: 'TOO_LONG' };
        }

        if (!this.checkRateLimit(groupJid)) {
            return { success: false, message: 'RATE_LIMIT_EXCEEDED' };
        }

        const isBotAdm = await this.isBotAdmin(groupJid);
        if (!isBotAdm) {
            await this.logModeration(groupJid, 'rename', null, null, trimmed, performedBy, false, 'BOT_NOT_ADMIN');
            return { success: false, message: 'BOT_NOT_ADMIN' };
        }

        try {
            await this.sock.groupUpdateSubject(groupJid, trimmed);
            await this.logModeration(groupJid, 'rename', null, null, trimmed, performedBy, true);
            return { success: true, message: 'RENAME_SUCCESS', data: { name: trimmed } };
        } catch (err) {
            await this.logModeration(groupJid, 'rename', null, null, trimmed, performedBy, false, String(err));
            return { success: false, message: 'RENAME_FAILED', data: { error: String(err) } };
        }
    }

    public async updateGroupDescription(
        groupJid: string,
        description: string,
        performedBy = 'SYSTEM'
    ): Promise<ModerationResult> {
        const trimmed = description.trim();
        if (trimmed.length < 1) {
            return { success: false, message: 'EMPTY' };
        }
        if (trimmed.length > 512) {
            return { success: false, message: 'TOO_LONG' };
        }

        if (!this.checkRateLimit(groupJid)) {
            return { success: false, message: 'RATE_LIMIT_EXCEEDED' };
        }

        const isBotAdm = await this.isBotAdmin(groupJid);
        if (!isBotAdm) {
            await this.logModeration(groupJid, 'description', null, null, trimmed, performedBy, false, 'BOT_NOT_ADMIN');
            return { success: false, message: 'BOT_NOT_ADMIN' };
        }

        try {
            await this.sock.groupUpdateDescription(groupJid, trimmed);
            await this.logModeration(groupJid, 'description', null, null, trimmed, performedBy, true);
            return { success: true, message: 'DESCRIPTION_SUCCESS' };
        } catch (err) {
            await this.logModeration(groupJid, 'description', null, null, trimmed, performedBy, false, String(err));
            return { success: false, message: 'DESCRIPTION_FAILED', data: { error: String(err) } };
        }
    }

    // Blacklist management
    public async resolveIdentityConditions(
        groupJid: string,
        targetJid: string,
        providedMetadata?: GroupMetadata
    ): Promise<Array<Record<string, string>>> {
        const cleaned = cleanId(targetJid);
        const digits = cleaned.replace(/\D/g, '');

        const conditions: Array<Record<string, string>> = [
            { userJid: targetJid },
            { userJid: `${cleaned}@s.whatsapp.net` },
            { userJid: `${cleaned}@lid` }
        ];
        if (digits) {
            conditions.push({ userPhone: digits });
        }

        // Cross-resolve phone number and LID mappings from User table
        try {
            const user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { id: targetJid },
                        { id: `${cleaned}@s.whatsapp.net` },
                        { lid: targetJid },
                        { lid: cleaned },
                        { lid: `${cleaned}@lid` }
                    ]
                }
            });
            if (user) {
                if (user.id) {
                    const uClean = cleanId(user.id);
                    const uDigits = uClean.replace(/\D/g, '');
                    conditions.push({ userJid: user.id }, { userJid: `${uClean}@s.whatsapp.net` });
                    if (uDigits) {
                        conditions.push({ userPhone: uDigits });
                    }
                }
                if (user.lid) {
                    const uLidClean = cleanId(user.lid);
                    conditions.push({ userJid: user.lid }, { userJid: `${uLidClean}@lid` });
                }
            }
        } catch {
            /* ignore User table lookup */
        }

        // Cross-resolve identities from group metadata if socket is available
        try {
            const metadata = providedMetadata ?? (await this.sock.groupMetadata(groupJid));
            const participant = metadata.participants.find((p) => {
                const pClean = cleanId(p.id);
                const pLid = getParticipantLid(p);
                return pClean === cleaned || pLid === cleaned;
            });
            if (participant) {
                if (participant.id && !participant.id.endsWith('@lid')) {
                    const pClean = cleanId(participant.id);
                    const pDigits = pClean.replace(/\D/g, '');
                    conditions.push({ userJid: participant.id }, { userJid: `${pClean}@s.whatsapp.net` });
                    if (pDigits) {
                        conditions.push({ userPhone: pDigits });
                    }
                }
                if (
                    'phoneNumber' in participant &&
                    typeof participant.phoneNumber === 'string' &&
                    participant.phoneNumber
                ) {
                    const pDigits = participant.phoneNumber.replace(/\D/g, '');
                    conditions.push({ userJid: `${pDigits}@s.whatsapp.net` });
                    if (pDigits) {
                        conditions.push({ userPhone: pDigits });
                    }
                }
                const pLid = getParticipantLid(participant);
                if (pLid) {
                    conditions.push({ userJid: `${pLid}@lid` });
                }
            }
        } catch {
            /* ignore groupMetadata resolution */
        }

        return conditions;
    }

    public async isBlacklisted(
        groupJid: string,
        targetJid: string,
        providedMetadata?: GroupMetadata
    ): Promise<boolean> {
        if (!groupJid || !targetJid) return false;

        try {
            const conditions = await this.resolveIdentityConditions(groupJid, targetJid, providedMetadata);
            const existing = await prisma.groupBlacklist.findFirst({
                where: {
                    groupJid,
                    OR: conditions
                }
            });

            return Boolean(existing);
        } catch (err) {
            console.error(`[ModerationService] Error checking blacklist for ${targetJid} in ${groupJid}:`, err);
            return false;
        }
    }

    public async addToBlacklist(
        groupJid: string,
        targetJid: string,
        reason = 'No reason provided',
        addedBy = 'SYSTEM'
    ): Promise<ModerationResult> {
        const cleaned = cleanId(targetJid);
        const digits = cleaned.replace(/\D/g, '');
        const canonicalJid = targetJid.includes('@') ? targetJid : `${cleaned}@s.whatsapp.net`;

        const already = await this.isBlacklisted(groupJid, targetJid);
        if (already) {
            return { success: false, message: 'ALREADY_BLACKLISTED' };
        }

        try {
            await prisma.groupBlacklist.create({
                data: {
                    groupJid,
                    userJid: canonicalJid,
                    userPhone: digits || null,
                    reason,
                    addedBy,
                    addedAt: new Date()
                }
            });
            await this.logModeration(groupJid, 'blacklist_add', canonicalJid, digits, reason, addedBy, true);
        } catch (err) {
            console.error('[ModerationService] Failed to add to GroupBlacklist:', err);
            return { success: false, message: 'BLACKLIST_ADD_FAILED', data: { error: String(err) } };
        }

        // Kick user immediately if currently in group
        let kicked = false;
        const isMember = await this.isUserMember(groupJid, targetJid);
        if (isMember) {
            const kickRes = await this.kickMember(
                groupJid,
                targetJid,
                `Blacklisted by ${addedBy}: ${reason}`,
                'SYSTEM'
            );
            kicked = kickRes.success;
        }

        return { success: true, message: 'BLACKLIST_ADDED', data: { targetJid: canonicalJid, reason, kicked } };
    }

    public async removeFromBlacklist(
        groupJid: string,
        targetJid: string,
        performedBy = 'SYSTEM',
        providedMetadata?: GroupMetadata
    ): Promise<ModerationResult> {
        try {
            const conditions = await this.resolveIdentityConditions(groupJid, targetJid, providedMetadata);
            const existing = await prisma.groupBlacklist.findFirst({
                where: {
                    groupJid,
                    OR: conditions
                }
            });

            if (!existing) {
                return { success: false, message: 'NOT_BLACKLISTED' };
            }

            await prisma.groupBlacklist.delete({
                where: { id: existing.id }
            });
            await this.logModeration(
                groupJid,
                'blacklist_remove',
                existing.userJid,
                existing.userPhone,
                null,
                performedBy,
                true
            );

            return { success: true, message: 'BLACKLIST_REMOVED', data: { targetJid: existing.userJid } };
        } catch (err) {
            console.error('[ModerationService] Failed to remove from GroupBlacklist:', err);
            return { success: false, message: 'BLACKLIST_REMOVE_FAILED', data: { error: String(err) } };
        }
    }

    public async getBlacklist(groupJid: string): Promise<ModerationResult> {
        try {
            const list = await prisma.groupBlacklist.findMany({
                where: { groupJid },
                orderBy: { addedAt: 'desc' }
            });
            return { success: true, message: 'BLACKLIST_LIST', data: { entries: list } };
        } catch (err) {
            console.error('[ModerationService] Failed to get GroupBlacklist:', err);
            return { success: false, message: 'BLACKLIST_LIST_FAILED', data: { error: String(err) } };
        }
    }

    public async enforceBlacklist(groupJid: string): Promise<void> {
        try {
            const blacklist = await prisma.groupBlacklist.findMany({ where: { groupJid } });
            if (blacklist.length === 0) return;

            const metadata = await this.sock.groupMetadata(groupJid);
            for (const participant of metadata.participants) {
                const isBl = await this.isBlacklisted(groupJid, participant.id);
                if (isBl) {
                    await this.kickMember(groupJid, participant.id, 'User is blacklisted from this group', 'SYSTEM');
                    const mentions = formatMentions(participant.id);
                    const displayId = cleanId(participant.id);
                    await this.sock.sendMessage(groupJid, {
                        text: `⚠️ @${displayId} was automatically removed because they are blacklisted from this group.`,
                        mentions
                    });
                }
            }
        } catch (err) {
            console.error(`[ModerationService] Error enforcing blacklist on group ${groupJid}:`, err);
        }
    }
}

/**
 * Resolves the target JID from message mentions, quoted message, or raw text input.
 */
export function resolveTargetJid(msg: WAMessage, input?: string): string | null {
    if (!msg) return null;
    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    if (mentions && mentions.length > 0 && mentions[0]) {
        return mentions[0];
    }

    const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
    if (quotedParticipant) {
        return quotedParticipant;
    }

    if (input && typeof input === 'string') {
        const cleaned = input.trim().replace(/^@/, '').replace(/[^\d]/g, '');
        if (cleaned.length >= 8 && cleaned.length <= 15) {
            return `${cleaned}@s.whatsapp.net`;
        }
    }

    return null;
}
