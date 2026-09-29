import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid, getUser, cleanId } from '../utils/casino.js';
import { encryptString, decryptString } from '../services/storageEncryption.js';
import { maskPhoneNumber } from '../utils/phone.js';
import { extractLeadingMonospace, unwrapMonospace } from '../utils/monospace.js';
import {
    validateContactNameWithAI,
    validatePhoneNumber,
    resolveMentionedContact,
    createEncryptedContactBackup,
    restoreEncryptedContactBackup,
    saveAutoSnapshotBackup
} from '../services/contactService.js';
import { downloadMediaMessage, WAMessage } from '@whiskeysockets/baileys';

/**
 * Parses alias and phone number from the rest of the arguments.
 * Supports WhatsApp monospace format (e.g. `Ls Friends` or ```Ls Friends```)
 * as well as standard unquoted single-word alias format.
 */
export function parseContactAddArgs(rest: string): { alias: string; phoneInput: string } {
    let alias: string;
    let phoneInput: string;

    const extraction = extractLeadingMonospace(rest);
    if (extraction.matched) {
        alias = extraction.extracted;
        phoneInput = extraction.remainder;
    } else {
        const parts = rest.split(/\s+/).filter(Boolean);
        alias = (parts[0] || '').trim();
        phoneInput = parts.slice(1).join(' ').trim();
    }

    alias = alias.replace(/\s+/g, ' ');
    return { alias, phoneInput };
}

/**
 * Removes WhatsApp mention tokens (e.g. `@6281234567890`) from a raw argument string.
 * WhatsApp renders a mention as an `@<digits>` literal in the text body while the
 * authoritative target JID lives in `contextInfo.mentionedJid`.
 */
export function stripMentionTokens(rest: string, mentionedJids: string[]): string {
    let cleaned = rest;
    for (const jid of mentionedJids) {
        const digits = cleanId(jid);
        if (!digits) continue;
        cleaned = cleaned.replace(new RegExp(`@?\\+?${digits}`, 'g'), ' ');
    }
    // Drop any leftover bare mention token that has no matching contextInfo entry
    cleaned = cleaned.replace(/@[\d\s]{8,20}/g, ' ');
    return cleaned.replace(/\s+/g, ' ').trim();
}

export interface ParsedContactAddArgs {
    alias: string;
    phoneInput: string;
    /** True when the target was supplied as a WhatsApp mention/tag instead of a raw number. */
    isMention: boolean;
    /** The raw mention target exactly as provided by WhatsApp (`jid@lid` or `jid@s.whatsapp.net`). */
    mentionJid: string;
}

/**
 * Parses `.contact add` arguments for both the numeric and the mention (tag) form.
 *
 * Numeric form:  `Ibu 6281234567890` or `` `Ls Friends` 6281234567890 ``
 * Mention form:  `Ibu @ibu` (tagging a group participant) or a bare `@ibu` tag,
 *                in which case the caller falls back to the participant's push name.
 *
 * When a mention is present, every mention token is stripped from the raw text so
 * the leftover words are interpreted as the alias.
 */
export function parseContactAddArgsWithMention(rest: string, mentionedJids: string[]): ParsedContactAddArgs {
    const mentions = mentionedJids.filter((j) => Boolean(cleanId(j)));
    if (mentions.length === 0) {
        const { alias, phoneInput } = parseContactAddArgs(rest);
        return { alias, phoneInput, isMention: false, mentionJid: '' };
    }

    const leftover = stripMentionTokens(rest, mentions);
    // Allow a monospace/quoted alias next to the tag, e.g. `.contact add `Ls Friends` @tag`
    const extraction = extractLeadingMonospace(leftover);
    const rawAlias = extraction.matched ? extraction.extracted : leftover;
    const alias = rawAlias.replace(/\s+/g, ' ').trim();

    return {
        alias,
        phoneInput: '',
        isMention: true,
        mentionJid: mentions[0]
    };
}

/**
 * Parses alias for deletion, unwrapping any monospace backticks or quotes if present.
 */
export function parseContactDelArgs(rest: string): string {
    const unwrapped = unwrapMonospace(rest);
    return unwrapped.text.replace(/\s+/g, ' ');
}

const contactTool: ToolModule = {
    definition: {
        name: 'contact',
        aliases: ['kontak', '.contact', '.kontak'],
        description: 'Manage personal zero-knowledge contacts, backup encrypted contact files, and restore contacts.',
        descriptionKey: 'tools.commands.contact.description',
        category: 'Utility',
        parameters: {
            type: 'object',
            properties: {
                rawText: {
                    type: 'string',
                    description:
                        'Subcommand and parameters (e.g., add `Ls Friends` 6281234567890, add Ibu @tag, list, del `Ls Friends`, backup, restore)'
                }
            }
        }
    },
    execute: async (args: Record<string, unknown>, ctx: ToolContext) => {
        const { msg, sock } = ctx;
        const senderJid = getSenderJid(msg, sock);
        if (!senderJid) return;

        // Ensure user exists in database
        await getUser(prisma, senderJid);

        const rawText = typeof args.rawText === 'string' ? args.rawText.trim() : '';
        const subCommandMatch = rawText.match(/^([a-zA-Z]+)(?:\s+([\s\S]*))?$/);
        const subCommand = subCommandMatch ? subCommandMatch[1].toLowerCase() : '';
        const rest = subCommandMatch && subCommandMatch[2] ? subCommandMatch[2].trim() : '';

        // 1. ADD CONTACT
        if (subCommand === 'add') {
            const mentionedJidList = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const { alias, phoneInput, isMention, mentionJid } = parseContactAddArgsWithMention(rest, mentionedJidList);

            // Resolve the tagged participant into a storable JID (handles @lid -> phone mapping)
            let mentionTarget: Awaited<ReturnType<typeof resolveMentionedContact>> | null = null;
            if (isMention) {
                mentionTarget = await resolveMentionedContact(mentionJid, sock, msg.key.remoteJid);
                if (!mentionTarget.isValid) {
                    await sock.sendMessage(
                        msg.key.remoteJid!,
                        {
                            text:
                                `❌ Could not resolve the tagged user: ${mentionTarget.reason || 'unknown error'}\n` +
                                `Please re-tag the contact and try again.`
                        },
                        { quoted: msg }
                    );
                    return;
                }
            }

            // Resolve the effective alias: explicit alias, else the tagged participant's push name
            const explicitAlias = alias;
            const effectiveAlias = explicitAlias || mentionTarget?.displayName || '';

            if (!effectiveAlias || (!phoneInput && !mentionTarget)) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    {
                        text:
                            '❌ Invalid format.\n' +
                            'Usage: *.contact add <alias> <phoneNumber>*\n' +
                            'Example: *.contact add Mom 6281234567890*\n' +
                            'With spaces: *.contact add `Ls Friends` 6281234567890*\n' +
                            'In a group, tag the person instead: *.contact add Ibu @tag*'
                    },
                    { quoted: msg }
                );
                return;
            }

            // Real-time AI filtering and validation for contact name
            const nameCheck = await validateContactNameWithAI(effectiveAlias);
            if (!nameCheck.isValid) {
                if (nameCheck.isMisspelled && nameCheck.suggestedCorrection) {
                    const retryTarget = mentionTarget ? '@tag' : phoneInput;
                    await sock.sendMessage(
                        msg.key.remoteJid!,
                        {
                            text:
                                `❌ Contact name rejected: *"${effectiveAlias}"* appears to be misspelled.\n` +
                                `Did you mean *"${nameCheck.suggestedCorrection}"*?\n\n` +
                                `Please run:\n` +
                                `*.contact add \`${nameCheck.suggestedCorrection}\` ${retryTarget}*`
                        },
                        { quoted: msg }
                    );
                    return;
                }

                await sock.sendMessage(
                    msg.key.remoteJid!,
                    { text: `❌ Contact name rejected: ${nameCheck.reason}` },
                    { quoted: msg }
                );
                return;
            }

            let canonicalJid: string;
            if (mentionTarget) {
                // A tagged group participant is already a verified WhatsApp account
                canonicalJid = mentionTarget.canonicalJid;
            } else {
                // Phone number normalization & WhatsApp existence validation
                const phoneCheck = await validatePhoneNumber(phoneInput, sock);
                if (!phoneCheck.isValid) {
                    await sock.sendMessage(
                        msg.key.remoteJid!,
                        {
                            text: `❌ Invalid phone number: ${phoneCheck.reason || 'Please provide a valid 8-15 digit phone number.'}`
                        },
                        { quoted: msg }
                    );
                    return;
                }
                canonicalJid = phoneCheck.canonicalJid;
            }

            const cleanAlias = effectiveAlias.toLowerCase();
            const encryptedJid = encryptString(canonicalJid);

            await prisma.userContactBook.upsert({
                where: {
                    ownerJid_alias: {
                        ownerJid: senderJid,
                        alias: cleanAlias
                    }
                },
                create: {
                    ownerJid: senderJid,
                    alias: cleanAlias,
                    encryptedJid
                },
                update: {
                    encryptedJid,
                    updatedAt: new Date()
                }
            });

            // Auto-snapshot backup
            await saveAutoSnapshotBackup(senderJid);

            const masked = maskPhoneNumber(canonicalJid);
            const source = mentionTarget ? 'tagged participant' : 'phone number';
            await sock.sendMessage(
                msg.key.remoteJid!,
                {
                    text:
                        `✅ Contact *${effectiveAlias}* has been successfully saved with number ${masked}.\n` +
                        `Source: ${source}.\n` +
                        `All stored numbers are protected with AES-256-GCM zero-knowledge encryption.`
                },
                { quoted: msg }
            );
            return;
        }

        // 2. LIST CONTACTS
        if (subCommand === 'list' || subCommand === 'all') {
            const contacts = await prisma.userContactBook.findMany({
                where: { ownerJid: senderJid },
                orderBy: { alias: 'asc' }
            });

            if (contacts.length === 0) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    {
                        text:
                            '📋 *Your Saved Contacts*\n\nYou do not have any registered contacts yet.\n' +
                            'Add one with: *.contact add <alias> <phoneNumber>*\n' +
                            'Example: *.contact add `Ls Friends` 6281234567890*\n' +
                            'In a group you can also tag someone: *.contact add Ibu @tag*'
                    },
                    { quoted: msg }
                );
                return;
            }

            const lines = contacts.map((c) => {
                let displayPhone: string;
                try {
                    const decrypted = decryptString(c.encryptedJid);
                    displayPhone = maskPhoneNumber(decrypted);
                } catch {
                    displayPhone = '🔒 Encrypted';
                }
                return `• *${c.alias}*: ${displayPhone}`;
            });

            const text = `📋 *Your Saved Contacts (${contacts.length})*\n\n${lines.join('\n')}\n\n_Protected with Zero-Knowledge Tokenization._\n_Use .contact backup to export an encrypted backup file._`;
            await sock.sendMessage(msg.key.remoteJid!, { text }, { quoted: msg });
            return;
        }

        // 3. DELETE CONTACT
        if (subCommand === 'del' || subCommand === 'delete' || subCommand === 'rm') {
            const alias = parseContactDelArgs(rest);
            if (!alias) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    {
                        text:
                            '❌ Please specify the alias to delete.\n' +
                            'Usage: *.contact del <alias>*\n' +
                            'Example: *.contact del Mom* or *.contact del `Ls Friends`*'
                    },
                    { quoted: msg }
                );
                return;
            }

            const cleanAlias = alias.toLowerCase();
            const existing = await prisma.userContactBook.findUnique({
                where: {
                    ownerJid_alias: {
                        ownerJid: senderJid,
                        alias: cleanAlias
                    }
                }
            });

            if (!existing) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    { text: `❌ Contact *${alias}* was not found in your contact book.` },
                    { quoted: msg }
                );
                return;
            }

            await prisma.userContactBook.delete({
                where: {
                    ownerJid_alias: {
                        ownerJid: senderJid,
                        alias: cleanAlias
                    }
                }
            });

            // Refresh auto-snapshot backup
            await saveAutoSnapshotBackup(senderJid);

            await sock.sendMessage(
                msg.key.remoteJid!,
                { text: `✅ Contact *${alias}* has been deleted from your contact book.` },
                { quoted: msg }
            );
            return;
        }

        // 4. ENCRYPTED BACKUP
        if (subCommand === 'backup' || subCommand === 'export') {
            const backupRes = await createEncryptedContactBackup(senderJid);
            if (!backupRes.success) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    { text: `❌ Failed to create encrypted backup: ${backupRes.error || 'Unknown error'}` },
                    { quoted: msg }
                );
                return;
            }

            if (backupRes.contactCount === 0) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    {
                        text: '⚠️ You do not have any registered contacts to back up.\nAdd a contact first with: *.contact add <alias> <number>*'
                    },
                    { quoted: msg }
                );
                return;
            }

            await sock.sendMessage(
                msg.key.remoteJid!,
                {
                    document: backupRes.encryptedBuffer,
                    fileName: backupRes.fileName,
                    mimetype: 'application/octet-stream',
                    caption:
                        `🔐 *Personal Encrypted Contact Backup*\n\n` +
                        `• Total Contacts: *${backupRes.contactCount}*\n` +
                        `• Algorithm: *AES-256-GCM*\n` +
                        `• Integrity Checksum: \`${backupRes.checksum.slice(0, 16)}...\`\n` +
                        `• Local Snapshot: \`${backupRes.filePath}\`\n\n` +
                        `_All numbers are secured with zero-knowledge cryptography. To restore, reply to this document with .contact restore._`
                },
                { quoted: msg }
            );
            return;
        }

        // 5. RESTORE BACKUP
        if (subCommand === 'restore' || subCommand === 'import') {
            let encryptedBuffer: Buffer | undefined;

            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const docMsg = quotedMsg?.documentMessage || msg.message?.documentMessage;

            if (docMsg) {
                try {
                    const targetMsg: WAMessage = quotedMsg
                        ? {
                              key: {
                                  remoteJid: msg.key.remoteJid,
                                  id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId
                              },
                              message: quotedMsg
                          }
                        : msg;
                    const downloaded = await downloadMediaMessage(targetMsg, 'buffer', {});
                    if (Buffer.isBuffer(downloaded)) {
                        encryptedBuffer = downloaded;
                    }
                } catch (downloadErr: unknown) {
                    console.error('[Contact Restore Document Download Error]', downloadErr);
                }
            }

            const restoreRes = await restoreEncryptedContactBackup(senderJid, encryptedBuffer);
            if (!restoreRes.success) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    {
                        text: `❌ Restore failed: ${restoreRes.error || 'Could not decrypt or restore contact backup file.'}`
                    },
                    { quoted: msg }
                );
                return;
            }

            await sock.sendMessage(
                msg.key.remoteJid!,
                {
                    text:
                        `✅ *Personal Contact Backup Restored Successfully*\n\n` +
                        `• Restored Contacts: *${restoreRes.restoredCount}*\n` +
                        `• Status: Verified & Encrypted (AES-256-GCM)\n\n` +
                        `Use *.contact list* to inspect your restored contacts.`
                },
                { quoted: msg }
            );
            return;
        }

        // USAGE HELP
        const usage =
            `📖 *Personal Contact Book Manager*\n\n` +
            `Securely manage personal contacts for AI messaging without exposing real numbers to LLMs.\n\n` +
            `*Commands:*\n` +
            `• *.contact add <alias> <number>* — Save or update contact (use \`name\` for spaces)\n` +
            `• *.contact add <alias> @tag* — Save a contact by tagging someone in a group\n` +
            `• *.contact add @tag* — Tag someone and use their display name as the alias\n` +
            `• *.contact list* — View all saved contacts (masked)\n` +
            `• *.contact del <alias>* — Delete a contact\n` +
            `• *.contact backup* — Export an encrypted personal contact backup file (.enc)\n` +
            `• *.contact restore* — Restore contacts from a quoted .enc file or local snapshot\n\n` +
            `*Examples:*\n` +
            `_.contact add Mom 6281234567890_\n` +
            `_.contact add \`Ls Friends\` 6281234567890_\n` +
            `_.contact add Ibu @tag_   ← tag a group member\n` +
            `_.contact backup_\n` +
            `_.sara please send a message to Mom saying I will be home soon._`;

        await sock.sendMessage(msg.key.remoteJid!, { text: usage }, { quoted: msg });
    }
};

export default contactTool;
