import { ToolModule, ToolContext } from './types.js';
import { prisma } from '../db.js';
import { getSenderJid, getUser } from '../utils/casino.js';
import { encryptString, decryptString } from '../services/storageEncryption.js';
import { cleanPhoneNumber, toCanonicalJid, maskPhoneNumber } from '../utils/phone.js';

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
                    description: 'Subcommand and parameters (e.g., add Mom 6281234567890, list, del Mom)'
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
        const parts = rawText.split(/\s+/).filter(Boolean);
        const subCommand = parts[0]?.toLowerCase() || '';

        if (subCommand === 'add') {
            const alias = parts[1];
            const phoneInput = parts[2];

            if (!alias || !phoneInput) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    {
                        text: '❌ Invalid format.\nUsage: *.contact add <alias> <phoneNumber>*\nExample: *.contact add Mom 6281234567890*'
                    },
                    { quoted: msg }
                );
                return;
            }

            const cleanAlias = alias.trim().toLowerCase();
            if (cleanAlias.length < 2 || cleanAlias.length > 32) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    { text: '❌ Alias must be between 2 and 32 characters.' },
                    { quoted: msg }
                );
                return;
            }

            const digits = cleanPhoneNumber(phoneInput);
            if (digits.length < 10 || digits.length > 15) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    { text: '❌ Invalid phone number. Please enter a valid 10-15 digit phone number.' },
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
                        text: '📋 *Your Saved Contacts*\n\nYou do not have any registered contacts yet.\nAdd one with: *.contact add <alias> <phoneNumber>*'
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
            const alias = parts[1];
            if (!alias) {
                await sock.sendMessage(
                    msg.key.remoteJid!,
                    { text: '❌ Please specify the alias to delete.\nUsage: *.contact del <alias>*' },
                    { quoted: msg }
                );
                return;
            }

            const cleanAlias = alias.trim().toLowerCase();
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
            `• *.contact add <alias> <number>* — Save or update contact\n` +
            `• *.contact list* — View all saved contacts (masked)\n` +
            `• *.contact del <alias>* — Delete a contact\n\n` +
            `*Example:*\n` +
            `_.contact add Mom 6281234567890_\n` +
            `_.sara please send a message to Mom saying I will be home soon._`;

        await sock.sendMessage(msg.key.remoteJid!, { text: usage }, { quoted: msg });
    }
};

export default contactTool;
