import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid, getUser } from '../utils/casino.js';
import { encryptString, decryptString } from '../services/storageEncryption.js';
import { cleanPhoneNumber, toCanonicalJid, maskPhoneNumber } from '../utils/phone.js';
import { extractLeadingMonospace, unwrapMonospace } from '../utils/monospace.js';
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
        aliases: ['kontak'],
        description: 'Manage personal zero-knowledge contacts for AI assistance and secure messaging.',
        descriptionKey: 'tools.commands.contact.description',
        category: 'Utility',
        parameters: {
            type: 'object',
            properties: {
                rawText: {
                    type: 'string',
                    description: 'Subcommand and parameters (e.g., add `Ls Friends` 123456789, list, del `Ls Friends`)'
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
                            'With spaces: *.contact add `Ls Friends` 123456789*'
                    },
                    { quoted: msg }
                );
                return;
            }

            const cleanAlias = alias.toLowerCase();
            if (cleanAlias.length < 2 || cleanAlias.length > 32) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    { text: '❌ Alias must be between 2 and 32 characters.' },
                    { quoted: msg }
                );
                return;
            }

            const digits = cleanPhoneNumber(phoneInput);
            if (digits.length < 8 || digits.length > 15) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    { text: '❌ Invalid phone number. Please enter a valid 8-15 digit phone number.' },
                    { quoted: msg }
                );
                return;
            }

            const canonicalJid = toCanonicalJid(digits);
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
                            'Example: *.contact add `Ls Friends` 123456789*'
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

            const text = `📋 *Your Saved Contacts (${contacts.length})*\n\n${lines.join('\n')}\n\n_Protected with Zero-Knowledge Tokenization._`;
            await sock.sendMessage(msg.key.remoteJid!, { text }, { quoted: msg });
            return;
        }

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

            await sock.sendMessage(
                msg.key.remoteJid!,
                { text: `✅ Contact *${alias}* has been deleted from your contact book.` },
                { quoted: msg }
            );
            return;
        }

        // Usage help
        const usage =
            `📖 *Personal Contact Book Manager*\n\n` +
            `Securely manage personal contacts for AI messaging without exposing real numbers to LLMs.\n\n` +
            `*Commands:*\n` +
            `• *.contact add <alias> <number>* — Save or update contact (use \`name\` for spaces)\n` +
            `• *.contact list* — View all saved contacts (masked)\n` +
            `• *.contact del <alias>* — Delete a contact\n\n` +
            `*Examples:*\n` +
            `_.contact add Mom 6281234567890_\n` +
            `_.contact add \`Ls Friends\` 123456789_\n` +
            `_.sara please send a message to Ls Friends saying I will be home soon._`;

        await sock.sendMessage(msg.key.remoteJid!, { text: usage }, { quoted: msg });
    }
};

export default contactTool;
