# Cosmos Moderation System — Design & Implementation Plan

> **Status:** Draft  
> **Based on:** [GitHub Issue #44](https://github.com/Razael-Fox/cosmos/issues/44)  
> **Target:** Cosmos WhatsApp Bot Framework  
> **Languages:** English (default) + Indonesian (id)

---

## Table of Contents

1. [Overview & Scope](#1-overview--scope)
2. [WhatsApp-Specific Constraints](#2-whatsapp-specific-constraints)
3. [Architecture Design](#3-architecture-design)
4. [Database Schema Changes](#4-database-schema-changes)
5. [Command Specifications](#5-command-specifications)
6. [Blacklist System Design](#6-blacklist-system-design)
7. [i18n Localization](#7-i18n-localization)
8. [Security & Permission Model](#8-security--permission-model)
9. [Implementation Phases](#9-implementation-phases)
10. [File Manifest](#10-file-manifest)
11. [Testing & Verification](#11-testing--verification)

---

## 1. Overview & Scope

This document describes the design and implementation plan for a comprehensive group moderation system within the Cosmos WhatsApp Bot. The system provides group administrators with tools to manage their WhatsApp groups effectively.

### Features

| # | Feature | Command | Description |
|---|---------|---------|-------------|
| 1 | Kick Member | `.group kick` | Remove a member from the group (non-admin only) |
| 2 | Close Group | `.group close` | Set group to admin-only messaging |
| 3 | Open Group | `.group open` | Allow all members to send messages |
| 4 | Invite Member | `.group invite` | Send a group invite link via DM with custom invitation card |
| 5 | Get Group Link | `.group link` | Retrieve the current group invite link |
| 6 | Approve Join Request | `.group approve` | Accept a pending join request |
| 7 | Reject Join Request | `.group reject` | Decline a pending join request |
| 8 | Promote Admin | `.group promote` | Grant admin privileges to a member |
| 9 | Demote Admin | `.group demote` | Revoke admin privileges from an admin |
| 10 | Edit Group Name | `.group rename` | Change the group title |
| 11 | Edit Group Description | `.group description` | Change the group description |
| 12 | Blacklist Add | `.group blacklist add` | Add a user to the group blacklist |
| 13 | Blacklist Remove | `.group blacklist remove` | Remove a user from the group blacklist |
| 14 | Blacklist List | `.group blacklist list` | List all blacklisted users |

---

## 2. WhatsApp-Specific Constraints

### 2.1 Kick Limitations

- **WhatsApp does NOT allow kicking group admins.** The bot can only remove non-admin members.
- If a user attempts to kick an admin, the bot must reject the action with a clear error message.
- The bot itself must be a group admin to perform any moderation actions.

### 2.2 No Ban System

- WhatsApp groups do not have a native "ban" concept like Discord.
- Instead, the **Group Blacklist System** (Section 6) provides equivalent functionality:
  - Blacklisted users are automatically kicked if they attempt to join.
  - The bot monitors group participant changes and enforces the blacklist.

### 2.3 Group Admin Hierarchy

- **Superadmin:** Group creator (cannot be removed by the bot).
- **Admin:** Can be promoted/demoted by the bot (if the bot is superadmin).
- **Member:** Regular participants that can be kicked.

### 2.4 Rate Limiting

- WhatsApp imposes rate limits on group operations. All moderation actions must be throttled.
- Recommended: Minimum 3-second interval between consecutive group operations.

---

## 3. Architecture Design

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Message Handler                       │
│  (src/handlers/message.ts)                              │
│  - Parses .group <action> commands                      │
│  - Validates admin permissions                           │
│  - Routes to ModerationService                          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              ModerationService                           │
│  (src/services/moderationService.ts)                     │
│  - Business logic for all moderation actions            │
│  - Permission validation                                │
│  - Rate limiting                                         │
│  - Audit logging                                         │
└──────┬──────────┬──────────┬──────────┬────────────────┘
       │          │          │          │
       ▼          ▼          ▼          ▼
┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────────────┐
│  Baileys │ │  Prisma  │ │  i18n  │ │  Blacklist   │
│  Socket  │ │  Client  │ │  Engine│ │  Enforcer    │
│  (WA API)│ │  (SQLite)│ │        │ │  (Listener)  │
└──────────┘ └──────────┘ └────────┘ └──────────────┘
```

### 3.2 Tool Registration Pattern

Each moderation command follows the existing Cosmos tool pattern:

```typescript
// src/tools/group_kick.ts
import { ToolDefinition, ToolContext, ToolModule } from './types.js';

export const definition: ToolDefinition = {
    name: 'group kick',
    title: 'Kick Group Member',
    displayNames: { en: 'Group Kick', id: 'Tendang Anggota' },
    category: 'Moderation',
    aliases: ['gkick', '.group kick', '.g kick'],
    description: 'Remove a member from the group. Only non-admin members can be removed.',
    descriptionKey: 'tools.commands.group_kick.description',
    parameters: {
        type: 'object',
        properties: {
            target: {
                type: 'string',
                description: 'Phone number, @mention, or reply to message'
            }
        },
        required: ['target']
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string> {
    // Implementation
}

export default { definition, execute } as ToolModule;
```

### 3.3 ModerationService Core

```typescript
// src/services/moderationService.ts

export interface ModerationAction {
    action: 'kick' | 'promote' | 'demote' | 'close' | 'open' | 'invite' | 'approve' | 'reject';
    targetJid?: string;
    targetPhone?: string;
    reason?: string;
}

export interface ModerationResult {
    success: boolean;
    message: string;
    data?: Record<string, any>;
}

export class ModerationService {
    private rateLimiter: Map<string, number>; // jid -> last action timestamp
    
    constructor(private sock: WASocket) {}
    
    // Permission checks
    async isBotAdmin(groupJid: string): Promise<boolean>;
    async isUserAdmin(groupJid: string, userJid: string): Promise<boolean>;
    async isUserMember(groupJid: string, userJid: string): Promise<boolean>;
    
    // Core actions
    async kickMember(groupJid: string, targetJid: string, reason?: string): Promise<ModerationResult>;
    async promoteAdmin(groupJid: string, targetJid: string): Promise<ModerationResult>;
    async demoteAdmin(groupJid: string, targetJid: string): Promise<ModerationResult>;
    async setGroupAnnounce(groupJid: string, announce: boolean): Promise<ModerationResult>;
    async inviteMember(groupJid: string, phone: string, inviterName: string, inviterJid: string): Promise<ModerationResult>;
    async getGroupLink(groupJid: string): Promise<ModerationResult>;
    async approveJoinRequest(groupJid: string, targetJid: string): Promise<ModerationResult>;
    async rejectJoinRequest(groupJid: string, targetJid: string): Promise<ModerationResult>;
    async updateGroupSubject(groupJid: string, subject: string): Promise<ModerationResult>;
    async updateGroupDescription(groupJid: string, description: string): Promise<ModerationResult>;
    
    // Blacklist management
    async addToBlacklist(groupJid: string, targetJid: string, reason: string): Promise<ModerationResult>;
    async removeFromBlacklist(groupJid: string, targetJid: string): Promise<ModerationResult>;
    async getBlacklist(groupJid: string): Promise<ModerationResult>;
    async isBlacklisted(groupJid: string, targetJid: string): Promise<boolean>;
    
    // Enforcement
    async enforceBlacklist(groupJid: string): Promise<void>;
}
```

---

## 4. Database Schema Changes

### 4.1 New Models (Prisma)

```prisma
// prisma/schema.prisma

model GroupBlacklist {
    id          String   @id @default(cuid())
    groupJid    String
    userJid     String
    userPhone   String?
    reason      String
    addedBy     String   // JID of admin who added
    addedAt     DateTime @default(now())
    
    @@unique([groupJid, userJid])
    @@index([groupJid])
    @@index([userJid])
}

model ModerationLog {
    id          String   @id @default(cuid())
    groupJid    String
    action      String   // kick, promote, demote, close, open, invite, approve, reject, blacklist_add, blacklist_remove
    targetJid   String?
    targetPhone String?
    reason      String?
    performedBy String   // JID of admin who performed the action
    performedAt DateTime @default(now())
    success     Boolean  @default(true)
    error       String?
    
    @@index([groupJid])
    @@index([performedBy])
    @@index([performedAt])
}
```

### 4.2 SQLite DDL (for ensureDatabaseSchema)

```sql
-- Group Blacklist Table
CREATE TABLE IF NOT EXISTS GroupBlacklist (
    id          TEXT PRIMARY KEY,
    groupJid    TEXT NOT NULL,
    userJid     TEXT NOT NULL,
    userPhone   TEXT,
    reason      TEXT NOT NULL,
    addedBy     TEXT NOT NULL,
    addedAt     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(groupJid, userJid)
);

CREATE INDEX IF NOT EXISTS idx_group_blacklist_group ON GroupBlacklist(groupJid);
CREATE INDEX IF NOT EXISTS idx_group_blacklist_user ON GroupBlacklist(userJid);

-- Moderation Log Table
CREATE TABLE IF NOT EXISTS ModerationLog (
    id          TEXT PRIMARY KEY,
    groupJid    TEXT NOT NULL,
    action      TEXT NOT NULL,
    targetJid   TEXT,
    targetPhone TEXT,
    reason      TEXT,
    performedBy TEXT NOT NULL,
    performedAt TEXT NOT NULL DEFAULT (datetime('now')),
    success     INTEGER NOT NULL DEFAULT 1,
    error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_moderation_log_group ON ModerationLog(groupJid);
CREATE INDEX IF NOT EXISTS idx_moderation_log_performer ON ModerationLog(performedBy);
CREATE INDEX IF NOT EXISTS idx_moderation_log_time ON ModerationLog(performedAt);
```

---

## 5. Command Specifications

### 5.1 `.group kick` — Kick Member

| Attribute | Value |
|-----------|-------|
| **Name** | `group kick` |
| **Aliases** | `gkick`, `.g kick` |
| **Permission** | Group Admin |
| **Parameters** | `target` (phone number, @mention, or reply) |
| **Description** | Remove a non-admin member from the group |

**Flow:**
1. Validate the bot is a group admin.
2. Validate the caller is a group admin.
3. Resolve target JID from mention, phone number, or quoted message.
4. Check if target is a group member.
5. Check if target is a group admin → **reject if admin**.
6. Execute `sock.groupParticipantsUpdate(groupJid, [targetJid], 'remove')`.
7. Log the action to `ModerationLog`.
8. Return success message with mention.

**Error Cases:**
- `BOT_NOT_ADMIN` — Bot is not a group admin.
- `CALLER_NOT_ADMIN` — Caller is not a group admin.
- `TARGET_NOT_MEMBER` — Target is not in the group.
- `TARGET_IS_ADMIN` — Cannot kick a group admin (WhatsApp limitation).
- `TARGET_IS_SELF` — Cannot kick the bot itself.

---

### 5.2 `.group close` — Close Group (Admin-Only Messaging)

| Attribute | Value |
|-----------|-------|
| **Name** | `group close` |
| **Aliases** | `gclose`, `.g close` |
| **Permission** | Group Admin |
| **Description** | Set the group to admin-only messaging mode |

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Execute `sock.groupSettingUpdate(groupJid, 'announcement')`.
4. Log the action.
5. Return confirmation message.

---

### 5.3 `.group open` — Open Group (All Members Can Message)

| Attribute | Value |
|-----------|-------|
| **Name** | `group open` |
| **Aliases** | `gopen`, `.g open` |
| **Permission** | Group Admin |
| **Description** | Allow all members to send messages in the group |

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Execute `sock.groupSettingUpdate(groupJid, 'not_announcement')`.
4. Log the action.
5. Return confirmation message.

---

### 5.4 `.group invite` — Invite Member via DM Link

| Attribute | Value |
|-----------|-------|
| **Name** | `group invite` |
| **Aliases** | `ginvite`, `.g invite` |
| **Permission** | Group Admin |
| **Parameters** | `phone` (phone number in international format) |
| **Description** | Send a group invite link via direct message with a custom invitation card design |

**Design Rationale:**  
WhatsApp's spam detection system flags numbers that directly add users to groups via `groupParticipantsUpdate(..., 'add')`. To avoid this, the bot instead sends a **direct message** to the target user containing the group invite link with a visually appealing invitation card. The user can then choose to join voluntarily.

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Sanitize phone number (E.164 format).
4. Check if target is already a group member → skip if already member.
5. Retrieve group invite link via `sock.groupInviteCode(groupJid)`.
6. Fetch group metadata for group name.
7. Fetch sender's pushname for the invitation message.
8. Send a DM to the target user with the invitation card (see design below).
9. Log the action.
10. Return confirmation message to the group.

**Invitation Card Design:**

The DM sent to the target user uses a plain text format (no `ExternalAdReply` to ensure WhatsApp Business compatibility). The design is based on [GitHub Issue #44](https://github.com/Razael-Fox/cosmos/issues/44):

```
┌─────────────────────────────────────────┐
│  ┌─────┐                                │
│  │ 👤  │  Group Invitation              │
│  └─────┘                                │
│                                         │
│  User {userDisplay} invites you to      │
│  join the group:                        │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  📋 {groupName}                 │    │
│  │  👥 {memberCount} members       │    │
│  │  🔗 [Tap to Join]               │    │
│  └─────────────────────────────────┘    │
│                                         │
│  This invitation was sent by a group    │
│  admin. You can choose to accept or     │
│  ignore this invitation.                │
└─────────────────────────────────────────┘
```

**Implementation:**

```typescript
// src/tools/group_invite.ts

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const { sock, msg, jid, t } = ctx;
    const { phone } = args;
    
    // ... validation ...
    
    // Get group invite link
    const inviteCode = await sock.groupInviteCode(groupJid);
    const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
    
    // Get group metadata
    const groupMetadata = await sock.groupMetadata(groupJid);
    const groupName = groupMetadata.subject;
    const memberCount = groupMetadata.participants.length;
    
    // Get sender display name
    const senderName = msg.pushName || 'Admin';
    
    // Send plain text invitation DM (WhatsApp Business compatible)
    await sock.sendMessage(`${phone}@s.whatsapp.net`, {
        text: t('tools.group_invite.dm_message', {
            userDisplay: senderName,
            groupName: groupName,
            memberCount: memberCount,
            inviteLink: inviteLink
        })
    });
    
    return t('tools.group_invite.success', { phone });
}
```

**Error Cases:**
- `BOT_NOT_ADMIN` — Bot is not a group admin.
- `CALLER_NOT_ADMIN` — Caller is not a group admin.
- `ALREADY_MEMBER` — Target is already a group member.
- `INVALID_PHONE` — Invalid phone number format.
- `DM_FAILED` — Failed to send DM (user may have blocked DMs from non-contacts).

---

### 5.5 `.group link` — Get Group Invite Link

| Attribute | Value |
|-----------|-------|
| **Name** | `group link` |
| **Aliases** | `glink`, `.g link` |
| **Permission** | Group Admin |
| **Description** | Retrieve the current group invite link |

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Execute `sock.groupInviteCode(groupJid)`.
4. Return the invite link `https://chat.whatsapp.com/<code>`.

---

### 5.6 `.group approve` — Approve Join Request

| Attribute | Value |
|-----------|-------|
| **Name** | `group approve` |
| **Aliases** | `gapprove`, `.g approve` |
| **Permission** | Group Admin |
| **Parameters** | `target` (phone number, @mention, or reply) |
| **Description** | Approve a pending join request |

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Resolve target JID.
4. Execute `sock.groupRequestParticipantsUpdate(groupJid, [targetJid], 'approve')`.
5. Log the action.
6. Return confirmation message.

---

### 5.7 `.group reject` — Reject Join Request

| Attribute | Value |
|-----------|-------|
| **Name** | `group reject` |
| **Aliases** | `greject`, `.g reject` |
| **Permission** | Group Admin |
| **Parameters** | `target` (phone number, @mention, or reply) |
| **Description** | Reject a pending join request |

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Resolve target JID.
4. Execute `sock.groupRequestParticipantsUpdate(groupJid, [targetJid], 'reject')`.
5. Log the action.
6. Return confirmation message.

---

### 5.8 `.group promote` — Promote to Admin

| Attribute | Value |
|-----------|-------|
| **Name** | `group promote` |
| **Aliases** | `gpromote`, `.g promote` |
| **Permission** | Group Admin |
| **Parameters** | `target` (phone number, @mention, or reply) |
| **Description** | Grant admin privileges to a group member |

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Resolve target JID.
4. Check if target is a group member.
5. Check if target is already an admin → skip if already admin.
6. Execute `sock.groupParticipantsUpdate(groupJid, [targetJid], 'promote')`.
7. Log the action.
8. Return success message with mention.

---

### 5.9 `.group demote` — Demote from Admin

| Attribute | Value |
|-----------|-------|
| **Name** | `group demote` |
| **Aliases** | `gdemote`, `.g demote` |
| **Permission** | Group Admin |
| **Parameters** | `target` (phone number, @mention, or reply) |
| **Description** | Revoke admin privileges from a group admin |

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Resolve target JID.
4. Check if target is a group admin.
5. Check if target is the group creator (superadmin) → **reject if superadmin**.
6. Execute `sock.groupParticipantsUpdate(groupJid, [targetJid], 'demote')`.
7. Log the action.
8. Return success message with mention.

---

### 5.10 `.group rename` — Edit Group Title

| Attribute | Value |
|-----------|-------|
| **Name** | `group rename` |
| **Aliases** | `grename`, `.g rename` |
| **Permission** | Group Admin |
| **Parameters** | `name` (new group title) |
| **Description** | Change the group title/name |

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Validate name length (1-25 characters).
4. Execute `sock.groupUpdateSubject(groupJid, name)`.
5. Log the action.
6. Return confirmation message.

---

### 5.11 `.group description` — Edit Group Description

| Attribute | Value |
|-----------|-------|
| **Name** | `group description` |
| **Aliases** | `gdesc`, `.g description` |
| **Permission** | Group Admin |
| **Parameters** | `description` (new group description) |
| **Description** | Change the group description |

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Validate description length (1-512 characters).
4. Execute `sock.groupUpdateDescription(groupJid, description)`.
5. Log the action.
6. Return confirmation message.

---

## 6. Blacklist System Design

### 6.1 Overview

Since WhatsApp does not have a native ban system, the blacklist system provides equivalent functionality. When a user is blacklisted:
- They are immediately kicked from the group (if present).
- If they attempt to re-join (via link or invite), the bot automatically kicks them.
- The group is notified with the reason for the kick.

### 6.2 Commands

#### `.group blacklist add` — Add to Blacklist

| Attribute | Value |
|-----------|-------|
| **Name** | `group blacklist add` |
| **Aliases** | `gbl add`, `.g blacklist add` |
| **Permission** | Group Admin |
| **Parameters** | `target` (phone number, @mention, or reply), `reason` (optional) |
| **Description** | Add a user to the group blacklist |

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Resolve target JID.
4. Check if target is already blacklisted → skip if already blacklisted.
5. Insert into `GroupBlacklist` table.
6. If target is currently in the group, kick them immediately.
7. Log the action.
8. Return confirmation message.

#### `.group blacklist remove` — Remove from Blacklist

| Attribute | Value |
|-----------|-------|
| **Name** | `group blacklist remove` |
| **Aliases** | `gbl remove`, `.g blacklist remove` |
| **Permission** | Group Admin |
| **Parameters** | `target` (phone number, @mention, or reply) |
| **Description** | Remove a user from the group blacklist |

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Resolve target JID.
4. Delete from `GroupBlacklist` table.
5. Log the action.
6. Return confirmation message.

#### `.group blacklist list` — List Blacklisted Users

| Attribute | Value |
|-----------|-------|
| **Name** | `group blacklist list` |
| **Aliases** | `gbl list`, `.g blacklist list` |
| **Permission** | Group Admin |
| **Description** | List all blacklisted users for this group |

**Flow:**
1. Validate bot admin status.
2. Validate caller admin status.
3. Query `GroupBlacklist` for this group.
4. Return formatted list with JID, phone, reason, and date added.

### 6.3 Blacklist Enforcement (Auto-Kick)

The blacklist is enforced via a **group participant change listener**:

```typescript
// src/services/blacklistEnforcer.ts

export class BlacklistEnforcer {
    constructor(
        private sock: WASocket,
        private moderationService: ModerationService
    ) {}
    
    /**
     * Listen for group participant changes and enforce blacklist.
     * Called once during bot initialization.
     */
    startListening(): void {
        this.sock.ev.on('group-participants.update', async (update) => {
            const { id: groupJid, participants, action } = update;
            
            if (action === 'add') {
                for (const participant of participants) {
                    const isBlacklisted = await this.moderationService.isBlacklisted(
                        groupJid,
                        participant
                    );
                    
                    if (isBlacklisted) {
                        // Auto-kick without approval
                        await this.moderationService.kickMember(
                            groupJid,
                            participant,
                            'User is blacklisted from this group'
                        );
                        
                        // Notify the group
                        await this.sock.sendMessage(groupJid, {
                            text: `⚠️ @${participant.split('@')[0]} was automatically removed because they are blacklisted from this group.`,
                            mentions: [participant]
                        });
                    }
                }
            }
        });
    }
}
```

### 6.4 Blacklist Enforcement Flow

```
User attempts to join group
        │
        ▼
┌─────────────────────┐
│ group-participants   │
│ .update event        │
│ (action: 'add')      │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Check if user JID   │
│ is in GroupBlacklist│
│ for this group      │
└─────────┬───────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
┌────────┐  ┌────────┐
│ YES    │  │ NO     │
│ Black- │  │ Not    │
│ listed │  │ Black- │
└───┬────┘  │ listed │
    │       └───┬────┘
    ▼           │
┌──────────┐    │
│ Auto-kick │    │
│ user     │    │
└────┬─────┘    │
     │          │
     ▼          │
┌──────────┐    │
│ Notify   │    │
│ group    │    │
│ with     │    │
│ reason   │    │
└──────────┘    │
                │
                ▼
          ┌──────────┐
          │ Allow    │
          │ user to  │
          │ stay     │
          └──────────┘
```

---

## 7. i18n Localization

### 7.1 Locale File Structure

All moderation strings are stored in the existing locale files:

- `src/locales/en/tools.json` — English strings
- `src/locales/id/tools.json` — Indonesian strings

### 7.2 English Strings (en/tools.json)

```json
{
    "group_kick": {
        "description": "Remove a non-admin member from the group.",
        "success": "✅ {{target}} has been removed from the group.",
        "bot_not_admin": "❌ I am not a group admin. Please grant me admin privileges to perform moderation actions.",
        "caller_not_admin": "❌ You must be a group admin to use this command.",
        "target_not_member": "❌ {{target}} is not a member of this group.",
        "target_is_admin": "❌ Cannot remove {{target}} because they are a group admin. WhatsApp does not allow removing admins.",
        "target_is_self": "❌ I cannot remove myself from the group.",
        "no_target": "❌ Please specify a target. Usage: .group kick <phone number or @mention>",
        "error": "❌ Failed to remove {{target}}: {{error}}"
    },
    "group_close": {
        "description": "Set the group to admin-only messaging mode.",
        "success": "🔒 Group is now closed. Only admins can send messages.",
        "already_closed": "ℹ️ The group is already in closed mode.",
        "error": "❌ Failed to close the group: {{error}}"
    },
    "group_open": {
        "description": "Allow all members to send messages in the group.",
        "success": "🔓 Group is now open. All members can send messages.",
        "already_open": "ℹ️ The group is already in open mode.",
        "error": "❌ Failed to open the group: {{error}}"
    },
    "group_invite": {
        "description": "Send a group invite link via direct message with a custom invitation card.",
        "success": "✅ An invitation has been sent to {{phone}} via direct message.",
        "already_member": "ℹ️ {{phone}} is already a member of this group.",
        "invalid_phone": "❌ Invalid phone number format. Use international format (e.g., 6281234567890).",
        "dm_failed": "❌ Failed to send invitation to {{phone}}. The user may have blocked DMs from non-contacts.",
        "error": "❌ Failed to invite {{phone}}: {{error}}",
        "dm_message": "*📋 GROUP INVITATION*\n\n> 👋 Hello!\n> *{{userDisplay}}* invites you to join the group.\n\n- 📋 *Group Name:* {{groupName}}\n- 👥 *Members:* {{memberCount}}\n\n> 🔗 *Invite Link:*\n> {{inviteLink}}\n\n> ℹ️ This invitation was sent by a group admin. You can choose to accept or ignore this invitation."
    },
    "group_link": {
        "description": "Retrieve the current group invite link.",
        "success": "🔗 Group invite link:\n\n{{link}}",
        "error": "❌ Failed to retrieve the group link: {{error}}"
    },
    "group_approve": {
        "description": "Approve a pending join request.",
        "success": "✅ Join request from {{target}} has been approved.",
        "no_pending": "ℹ️ There are no pending join requests from {{target}}.",
        "error": "❌ Failed to approve join request: {{error}}"
    },
    "group_reject": {
        "description": "Reject a pending join request.",
        "success": "✅ Join request from {{target}} has been rejected.",
        "no_pending": "ℹ️ There are no pending join requests from {{target}}.",
        "error": "❌ Failed to reject join request: {{error}}"
    },
    "group_promote": {
        "description": "Grant admin privileges to a group member.",
        "success": "✅ {{target}} has been promoted to group admin.",
        "already_admin": "ℹ️ {{target}} is already a group admin.",
        "target_not_member": "❌ {{target}} is not a member of this group.",
        "error": "❌ Failed to promote {{target}}: {{error}}"
    },
    "group_demote": {
        "description": "Revoke admin privileges from a group admin.",
        "success": "✅ {{target}} has been demoted from group admin.",
        "not_admin": "ℹ️ {{target}} is not a group admin.",
        "target_is_creator": "❌ Cannot demote {{target}} because they are the group creator.",
        "error": "❌ Failed to demote {{target}}: {{error}}"
    },
    "group_rename": {
        "description": "Change the group title/name.",
        "success": "✅ Group title has been changed to:\n\n*{{name}}*",
        "too_short": "❌ Group title must be at least 1 character long.",
        "too_long": "❌ Group title cannot exceed 25 characters.",
        "error": "❌ Failed to change group title: {{error}}"
    },
    "group_description": {
        "description": "Change the group description.",
        "success": "✅ Group description has been updated.",
        "too_long": "❌ Group description cannot exceed 512 characters.",
        "error": "❌ Failed to update group description: {{error}}"
    },
    "group_blacklist_add": {
        "description": "Add a user to the group blacklist.",
        "success": "🚫 {{target}} has been added to the group blacklist.\n\nReason: {{reason}}",
        "already_blacklisted": "ℹ️ {{target}} is already blacklisted.",
        "kicked": "⚠️ {{target}} was in the group and has been removed.",
        "no_reason": "No reason provided",
        "error": "❌ Failed to add {{target}} to blacklist: {{error}}"
    },
    "group_blacklist_remove": {
        "description": "Remove a user from the group blacklist.",
        "success": "✅ {{target}} has been removed from the group blacklist.",
        "not_blacklisted": "ℹ️ {{target}} is not blacklisted.",
        "error": "❌ Failed to remove {{target}} from blacklist: {{error}}"
    },
    "group_blacklist_list": {
        "description": "List all blacklisted users for this group.",
        "title": "🚫 Group Blacklist ({{count}} users)",
        "empty": "ℹ️ The blacklist is empty.",
        "entry": "• {{target}}\n  Reason: {{reason}}\n  Added: {{date}}",
        "error": "❌ Failed to retrieve blacklist: {{error}}"
    },
    "moderation": {
        "log_title": "📋 Moderation Log",
        "no_logs": "ℹ️ No moderation actions have been recorded."
    }
}
```

### 7.3 Indonesian Strings (id/tools.json)

```json
{
    "group_kick": {
        "description": "Keluarkan anggota non-admin dari grup.",
        "success": "✅ {{target}} telah dikeluarkan dari grup.",
        "bot_not_admin": "❌ Saya bukan admin grup. Mohon berikan hak admin untuk melakukan tindakan moderasi.",
        "caller_not_admin": "❌ Anda harus menjadi admin grup untuk menggunakan perintah ini.",
        "target_not_member": "❌ {{target}} bukan anggota grup ini.",
        "target_is_admin": "❌ Tidak dapat mengeluarkan {{target}} karena mereka adalah admin grup. WhatsApp tidak mengizinkan mengeluarkan admin.",
        "target_is_self": "❌ Saya tidak dapat mengeluarkan diri sendiri dari grup.",
        "no_target": "❌ Mohon tentukan target. Penggunaan: .group kick <nomor telepon atau @mention>",
        "error": "❌ Gagal mengeluarkan {{target}}: {{error}}"
    },
    "group_close": {
        "description": "Atur grup ke mode pesan khusus admin.",
        "success": "🔒 Grup sekarang ditutup. Hanya admin yang dapat mengirim pesan.",
        "already_closed": "ℹ️ Grup sudah dalam mode tertutup.",
        "error": "❌ Gagal menutup grup: {{error}}"
    },
    "group_open": {
        "description": "Izinkan semua anggota mengirim pesan di grup.",
        "success": "🔓 Grup sekarang dibuka. Semua anggota dapat mengirim pesan.",
        "already_open": "ℹ️ Grup sudah dalam mode terbuka.",
        "error": "❌ Gagal membuka grup: {{error}}"
    },
    "group_invite": {
        "description": "Kirim tautan undangan grup melalui pesan langsung dengan kartu undangan kustom.",
        "success": "✅ Undangan telah dikirim ke {{phone}} melalui pesan langsung.",
        "already_member": "ℹ️ {{phone}} sudah menjadi anggota grup ini.",
        "invalid_phone": "❌ Format nomor telepon tidak valid. Gunakan format internasional (mis., 6281234567890).",
        "dm_failed": "❌ Gagal mengirim undangan ke {{phone}}. Pengguna mungkin memblokir DM dari non-kontak.",
        "error": "❌ Gagal mengundang {{phone}}: {{error}}",
        "dm_message": "*📋 UNDANGAN GRUP*\n\n> 👋 Halo!\n> *{{userDisplay}}* mengundang Anda untuk bergabung dengan grup.\n\n- 📋 *Nama Grup:* {{groupName}}\n- 👥 *Anggota:* {{memberCount}}\n\n> 🔗 *Tautan Undangan:*\n> {{inviteLink}}\n\n> ℹ️ Undangan ini dikirim oleh admin grup. Anda dapat memilih untuk menerima atau mengabaikan undangan ini."
    },
    "group_link": {
        "description": "Dapatkan tautan undangan grup saat ini.",
        "success": "🔗 Tautan undangan grup:\n\n{{link}}",
        "error": "❌ Gagal mendapatkan tautan grup: {{error}}"
    },
    "group_approve": {
        "description": "Setujui permintaan bergabung yang tertunda.",
        "success": "✅ Permintaan bergabung dari {{target}} telah disetujui.",
        "no_pending": "ℹ️ Tidak ada permintaan bergabung yang tertunda dari {{target}}.",
        "error": "❌ Gagal menyetujui permintaan bergabung: {{error}}"
    },
    "group_reject": {
        "description": "Tolak permintaan bergabung yang tertunda.",
        "success": "✅ Permintaan bergabung dari {{target}} telah ditolak.",
        "no_pending": "ℹ️ Tidak ada permintaan bergabung yang tertunda dari {{target}}.",
        "error": "❌ Gagal menolak permintaan bergabung: {{error}}"
    },
    "group_promote": {
        "description": "Berikan hak admin kepada anggota grup.",
        "success": "✅ {{target}} telah dipromosikan menjadi admin grup.",
        "already_admin": "ℹ️ {{target}} sudah menjadi admin grup.",
        "target_not_member": "❌ {{target}} bukan anggota grup ini.",
        "error": "❌ Gagal mempromosikan {{target}}: {{error}}"
    },
    "group_demote": {
        "description": "Cabut hak admin dari admin grup.",
        "success": "✅ {{target}} telah diturunkan dari admin grup.",
        "not_admin": "ℹ️ {{target}} bukan admin grup.",
        "target_is_creator": "❌ Tidak dapat menurunkan {{target}} karena mereka adalah pembuat grup.",
        "error": "❌ Gagal menurunkan {{target}}: {{error}}"
    },
    "group_rename": {
        "description": "Ubah judul/nama grup.",
        "success": "✅ Judul grup telah diubah menjadi:\n\n*{{name}}*",
        "too_short": "❌ Judul grup minimal 1 karakter.",
        "too_long": "❌ Judul grup tidak boleh lebih dari 25 karakter.",
        "error": "❌ Gagal mengubah judul grup: {{error}}"
    },
    "group_description": {
        "description": "Ubah deskripsi grup.",
        "success": "✅ Deskripsi grup telah diperbarui.",
        "too_long": "❌ Deskripsi grup tidak boleh lebih dari 512 karakter.",
        "error": "❌ Gagal memperbarui deskripsi grup: {{error}}"
    },
    "group_blacklist_add": {
        "description": "Tambahkan pengguna ke daftar hitam grup.",
        "success": "🚫 {{target}} telah ditambahkan ke daftar hitam grup.\n\nAlasan: {{reason}}",
        "already_blacklisted": "ℹ️ {{target}} sudah ada di daftar hitam.",
        "kicked": "⚠️ {{target}} ada di grup dan telah dikeluarkan.",
        "no_reason": "Tidak ada alasan yang diberikan",
        "error": "❌ Gagal menambahkan {{target}} ke daftar hitam: {{error}}"
    },
    "group_blacklist_remove": {
        "description": "Hapus pengguna dari daftar hitam grup.",
        "success": "✅ {{target}} telah dihapus dari daftar hitam grup.",
        "not_blacklisted": "ℹ️ {{target}} tidak ada di daftar hitam.",
        "error": "❌ Gagal menghapus {{target}} dari daftar hitam: {{error}}"
    },
    "group_blacklist_list": {
        "description": "Daftar semua pengguna yang ada di daftar hitam grup ini.",
        "title": "🚫 Daftar Hitam Grup ({{count}} pengguna)",
        "empty": "ℹ️ Daftar hitam kosong.",
        "entry": "• {{target}}\n  Alasan: {{reason}}\n  Ditambahkan: {{date}}",
        "error": "❌ Gagal mendapatkan daftar hitam: {{error}}"
    },
    "moderation": {
        "log_title": "📋 Log Moderasi",
        "no_logs": "ℹ️ Tidak ada tindakan moderasi yang tercatat."
    }
}
```

---

## 8. Security & Permission Model

### 8.1 Permission Hierarchy

```
┌─────────────────────────────────────────────┐
│              Bot Owner                       │
│  (OWNER_PHONE_NUMBER env var)               │
│  - Full access to all commands              │
│  - Can bypass group admin checks            │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│           Group Creator (Superadmin)         │
│  - Cannot be kicked or demoted              │
│  - Full moderation access                   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│           Group Admin                        │
│  - Can kick members (not admins)            │
│  - Can promote/demote other admins          │
│  - Can close/open group                     │
│  - Can invite members                       │
│  - Can manage blacklist                     │
│  - Can edit group name/description          │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│           Group Member                       │
│  - No moderation access                     │
│  - Subject to moderation actions            │
└─────────────────────────────────────────────┘
```

### 8.2 Permission Check Flow

```
Command Received
       │
       ▼
┌──────────────────┐
│ Is group chat?   │──NO──► ❌ "This command can only be used in groups."
└────────┬─────────┘
         │ YES
         ▼
┌──────────────────┐
│ Is bot admin?    │──NO──► ❌ "I am not a group admin."
└────────┬─────────┘
         │ YES
         ▼
┌──────────────────┐
│ Is caller admin? │──NO──► ❌ "You must be a group admin."
└────────┬─────────┘
         │ YES
         ▼
┌──────────────────┐
│ Is target valid? │──NO──► ❌ "Target not found / not a member."
└────────┬─────────┘
         │ YES
         ▼
┌──────────────────┐
│ Is target admin? │──YES──► ❌ "Cannot perform action on admin."
│ (for kick/demote)│
└────────┬─────────┘
         │ NO
         ▼
┌──────────────────┐
│ Execute action   │
└──────────────────┘
```

### 8.3 Rate Limiting

```typescript
// Rate limiter: max 1 action per 3 seconds per group
const RATE_LIMIT_MS = 3000;

private checkRateLimit(groupJid: string): boolean {
    const now = Date.now();
    const lastAction = this.rateLimiter.get(groupJid) || 0;
    
    if (now - lastAction < RATE_LIMIT_MS) {
        return false; // Rate limited
    }
    
    this.rateLimiter.set(groupJid, now);
    return true;
}
```

---

## 9. Implementation Phases

### Phase 1: Foundation (Database + Service Layer)

| Task | File(s) | Description |
|------|---------|-------------|
| 1.1 | `prisma/schema.prisma` | Add `GroupBlacklist` and `ModerationLog` models |
| 1.2 | `src/db.ts` | Add DDL for new tables in `ensureDatabaseSchema()` |
| 1.3 | `src/services/moderationService.ts` | Create `ModerationService` class with all methods |
| 1.4 | `src/services/blacklistEnforcer.ts` | Create `BlacklistEnforcer` class with event listener |

### Phase 2: Core Moderation Commands

| Task | File(s) | Description |
|------|---------|-------------|
| 2.1 | `src/tools/group_kick.ts` | Kick member command |
| 2.2 | `src/tools/group_close.ts` | Close group command |
| 2.3 | `src/tools/group_open.ts` | Open group command |
| 2.4 | `src/tools/group_invite.ts` | Invite member command |
| 2.5 | `src/tools/group_link.ts` | Get group link command |
| 2.6 | `src/tools/group_promote.ts` | Promote admin command |
| 2.7 | `src/tools/group_demote.ts` | Demote admin command |

### Phase 3: Group Metadata Commands

| Task | File(s) | Description |
|------|---------|-------------|
| 3.1 | `src/tools/group_rename.ts` | Edit group title command |
| 3.2 | `src/tools/group_description.ts` | Edit group description command |

### Phase 4: Join Request Commands

| Task | File(s) | Description |
|------|---------|-------------|
| 4.1 | `src/tools/group_approve.ts` | Approve join request command |
| 4.2 | `src/tools/group_reject.ts` | Reject join request command |

### Phase 5: Blacklist System

| Task | File(s) | Description |
|------|---------|-------------|
| 5.1 | `src/tools/group_blacklist_add.ts` | Add to blacklist command |
| 5.2 | `src/tools/group_blacklist_remove.ts` | Remove from blacklist command |
| 5.3 | `src/tools/group_blacklist_list.ts` | List blacklist command |
| 5.4 | `src/handlers/message.ts` | Integrate `BlacklistEnforcer` into message handler |

### Phase 6: i18n & Localization

| Task | File(s) | Description |
|------|---------|-------------|
| 6.1 | `src/locales/en/tools.json` | Add all English moderation strings |
| 6.2 | `src/locales/id/tools.json` | Add all Indonesian moderation strings |

### Phase 7: Integration & Testing

| Task | File(s) | Description |
|------|---------|-------------|
| 7.1 | `src/handlers/message.ts` | Register `BlacklistEnforcer` listener |
| 7.2 | — | Run `pnpm typecheck` |
| 7.3 | — | Run `pnpm lint` |
| 7.4 | — | Run `pnpm build` |
| 7.5 | — | Run `pnpm format` |
| 7.6 | — | Manual testing in test group |

---

## 10. File Manifest

### New Files

```
src/
├── services/
│   ├── moderationService.ts      # Core moderation business logic
│   └── blacklistEnforcer.ts      # Blacklist auto-kick listener
├── tools/
│   ├── group_kick.ts             # .group kick
│   ├── group_close.ts            # .group close
│   ├── group_open.ts             # .group open
│   ├── group_invite.ts           # .group invite
│   ├── group_link.ts             # .group link
│   ├── group_approve.ts          # .group approve
│   ├── group_reject.ts           # .group reject
│   ├── group_promote.ts          # .group promote
│   ├── group_demote.ts           # .group demote
│   ├── group_rename.ts           # .group rename
│   ├── group_description.ts      # .group description
│   ├── group_blacklist_add.ts    # .group blacklist add
│   ├── group_blacklist_remove.ts # .group blacklist remove
│   └── group_blacklist_list.ts   # .group blacklist list
```

### Modified Files

```
prisma/
├── schema.prisma                 # Add GroupBlacklist + ModerationLog models

src/
├── db.ts                         # Add DDL for new tables
├── handlers/
│   └── message.ts                # Integrate BlacklistEnforcer
└── locales/
    ├── en/
    │   └── tools.json            # Add English moderation strings
    └── id/
        └── tools.json            # Add Indonesian moderation strings
```

---

## 11. Testing & Verification

### 11.1 Automated Checks

```bash
# Type checking
pnpm typecheck

# Linting
pnpm lint

# Build
pnpm build

# Format
pnpm format
```

### 11.2 Manual Test Matrix

| Test Case | Command | Expected Result |
|-----------|---------|-----------------|
| Kick non-admin member | `.group kick @user` | User removed, confirmation message |
| Kick admin member | `.group kick @admin` | Error: "Cannot remove admin" |
| Kick self | `.group kick @bot` | Error: "Cannot remove myself" |
| Close group | `.group close` | Group set to announcement mode |
| Open group | `.group open` | Group set to not_announcement mode |
| Invite member | `.group invite 6281234567890` | Invitation DM sent with invite link |
| Get link | `.group link` | Invite link returned |
| Approve join | `.group approve @user` | Join request approved |
| Reject join | `.group reject @user` | Join request rejected |
| Promote member | `.group promote @user` | User promoted to admin |
| Demote admin | `.group demote @admin` | Admin demoted to member |
| Demote creator | `.group demote @creator` | Error: "Cannot demote creator" |
| Rename group | `.group rename New Name` | Group title updated |
| Edit description | `.group description New desc` | Group description updated |
| Blacklist add | `.group blacklist add @user spam` | User added to blacklist |
| Blacklist add (in group) | `.group blacklist add @user` | User added + kicked |
| Blacklist remove | `.group blacklist remove @user` | User removed from blacklist |
| Blacklist list | `.group blacklist list` | List of blacklisted users |
| Blacklisted user joins | (auto) | User auto-kicked + notified |
| Non-admin tries command | `.group kick @user` | Error: "You must be admin" |
| Bot not admin | `.group kick @user` | Error: "I am not admin" |

### 11.3 Edge Cases

- [ ] Target is already not in the group
- [ ] Target is already an admin (for promote)
- [ ] Target is already a member (for invite)
- [ ] Target is already blacklisted (for blacklist add)
- [ ] Target is not blacklisted (for blacklist remove)
- [ ] Phone number is invalid format
- [ ] Group name is too long (>25 chars)
- [ ] Group description is too long (>512 chars)
- [ ] Rate limiting is enforced (3s cooldown)
- [ ] Blacklist enforcement works on group-participants.update event
- [ ] Both English and Indonesian translations work correctly

---

## Appendix A: Baileys API Reference

| Operation | Baileys Method |
|-----------|---------------|
| Get group metadata | `sock.groupMetadata(jid)` |
| Kick participant | `sock.groupParticipantsUpdate(jid, [target], 'remove')` |
| Promote participant | `sock.groupParticipantsUpdate(jid, [target], 'promote')` |
| Demote participant | `sock.groupParticipantsUpdate(jid, [target], 'demote')` |
| Send invitation DM | `sock.sendMessage(phone + '@s.whatsapp.net', { text })` |
| Close group (announcement) | `sock.groupSettingUpdate(jid, 'announcement')` |
| Open group | `sock.groupSettingUpdate(jid, 'not_announcement')` |
| Get invite code | `sock.groupInviteCode(jid)` |
| Update group subject | `sock.groupUpdateSubject(jid, subject)` |
| Update group description | `sock.groupUpdateDescription(jid, description)` |
| Approve join request | `sock.groupRequestParticipantsUpdate(jid, [target], 'approve')` |
| Reject join request | `sock.groupRequestParticipantsUpdate(jid, [target], 'reject')` |

---

## Appendix B: Invitation DM Message Design

> **Design Reference:** [GitHub Issue #44](https://github.com/Razael-Fox/cosmos/issues/44)

The invitation message follows the **WhatsApp-Native Markdown** design system mandated by Issue #44. No Unicode box-drawing characters are used. The design uses native WhatsApp Markdown formatting for optimal rendering across all devices.

### WhatsApp-Native Markdown Rules (per Issue #44)

- `*...*` for titles and field labels
- `> ` blockquotes for callout sections — every line MUST have non-empty text (Zero-Empty-Quote Invariant)
- `\n\n` separates distinct sections
- `- ` / `1. ` for itemized breakdowns
- `` `...` `` strictly for commands, arguments, account numbers, hashes
- `_..._` for subtitles and italic descriptions
- **Zero Unicode box-drawing characters** (`╭`, `│`, `╰`, `┌`, `└`, `─`, `━`, `┃`)

### Anti-Spam Design Principles

1. **No direct add** — The bot never calls `groupParticipantsUpdate(..., 'add')` to add users directly. Instead, it sends a DM with the invite link.
2. **User consent** — The recipient voluntarily chooses to join by tapping the link.
3. **Plain text only** — No `ExternalAdReply` is used, ensuring the message is visible even when the bot uses WhatsApp Business API.
4. **Clear attribution** — The message clearly shows who sent the invitation (group admin name).
5. **Opt-out friendly** — The message includes a note that the recipient can ignore the invitation.
6. **Rate limited** — The bot enforces a 3-second cooldown between invitation sends to avoid bulk messaging.

### Message Template (English)

```
*📋 GROUP INVITATION*

> 👋 Hello! *{userDisplay}* invites you to join the group.

- 📋 *Group:* {groupName}
- 👥 *Members:* {memberCount}
- 🔗 *Invite Link:* {inviteLink}

> ℹ️ This invitation was sent by a group admin. You can choose to accept or ignore this invitation.
```

### Message Template (Indonesian)

```
*📋 UNDANGAN GRUP*

> 👋 Halo! *{userDisplay}* mengundang Anda untuk bergabung dengan grup.

- 📋 *Grup:* {groupName}
- 👥 *Anggota:* {memberCount}
- 🔗 *Tautan Undangan:* {inviteLink}

> ℹ️ Undangan ini dikirim oleh admin grup. Anda dapat memilih untuk menerima atau mengabaikan undangan ini.
```

---

## Appendix C: Command Quick Reference

| Command | Aliases | Permission | Description |
|---------|---------|------------|-------------|
| `.group kick <target>` | `.gkick`, `.g kick` | Admin | Remove a non-admin member |
| `.group close` | `.gclose`, `.g close` | Admin | Set admin-only messaging |
| `.group open` | `.gopen`, `.g open` | Admin | Allow all members to message |
| `.group invite <phone>` | `.ginvite`, `.g invite` | Admin | Invite a member by phone |
| `.group link` | `.glink`, `.g link` | Admin | Get group invite link |
| `.group approve <target>` | `.gapprove`, `.g approve` | Admin | Approve join request |
| `.group reject <target>` | `.greject`, `.g reject` | Admin | Reject join request |
| `.group promote <target>` | `.gpromote`, `.g promote` | Admin | Promote member to admin |
| `.group demote <target>` | `.gdemote`, `.g demote` | Admin | Demote admin to member |
| `.group rename <name>` | `.grename`, `.g rename` | Admin | Change group title |
| `.group description <desc>` | `.gdesc`, `.g description` | Admin | Change group description |
| `.group blacklist add <target> [reason]` | `.gbl add` | Admin | Add user to blacklist |
| `.group blacklist remove <target>` | `.gbl remove` | Admin | Remove user from blacklist |
| `.group blacklist list` | `.gbl list` | Admin | List blacklisted users |

---

*End of document.*
