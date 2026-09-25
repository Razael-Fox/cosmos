import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid, getUser } from '../utils/casino.js';
import { encryptString, decryptString } from '../services/storageEncryption.js';
import { maskPhoneNumber } from '../utils/phone.js';
import { extractLeadingMonospace, unwrapMonospace } from '../utils/monospace.js';
import {
    validateContactNameWithAI,
    validatePhoneNumber,
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
                        'Subcommand and parameters (e.g., add `Ls Friends` 6281234567890, list, del `Ls Friends`, backup, restore)'
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
            const { alias, phoneInput } = parseContactAddArgs(rest);

            if (!alias || !phoneInput) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    {
                        text:
                            '❌ Invalid format.\n' +
                            'Usage: *.contact add <alias> <phoneNumber>*\n' +
                            'Example: *.contact add Mom 6281234567890*\n' +
                            'With spaces: *.contact add `Ls Friends` 6281234567890*'
                    },
                    { quoted: msg }
                );
                return;
            }

            // Real-time AI filtering and validation for contact name
            const nameCheck = await validateContactNameWithAI(alias);
            if (!nameCheck.isValid) {
                if (nameCheck.isMisspelled && nameCheck.suggestedCorrection) {
                    await sock.sendMessage(
                        msg.key.remoteJid!,
                        {
                            text:
                                `❌ Contact name rejected: *"${alias}"* appears to be misspelled.\n` +
                                `Did you mean *"${nameCheck.suggestedCorrection}"*?\n\n` +
                                `Please run:\n` +
                                `*.contact add \`${nameCheck.suggestedCorrection}\` ${phoneInput}*`
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

            const cleanAlias = alias.toLowerCase();
            const canonicalJid = phoneCheck.canonicalJid;
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
            await sock.sendMessage(
                msg.key.remoteJid!,
                {
                    text: `✅ Contact *${alias}* has been successfully saved with number ${masked}.\nAll stored numbers are protected with AES-256-GCM zero-knowledge encryption.`
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
                            'Example: *.contact add `Ls Friends` 6281234567890*'
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
            `• *.contact list* — View all saved contacts (masked)\n` +
            `• *.contact del <alias>* — Delete a contact\n` +
            `• *.contact backup* — Export an encrypted personal contact backup file (.enc)\n` +
            `• *.contact restore* — Restore contacts from a quoted .enc file or local snapshot\n\n` +
            `*Examples:*\n` +
            `_.contact add Mom 6281234567890_\n` +
            `_.contact add \`Ls Friends\` 6281234567890_\n` +
            `_.contact backup_\n` +
            `_.sara please send a message to Mom saying I will be home soon._`;

        await sock.sendMessage(msg.key.remoteJid!, { text: usage }, { quoted: msg });
    }
};

export default contactTool;
