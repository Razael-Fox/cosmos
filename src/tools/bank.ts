import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { getSenderJid, cleanId, getUser, formatMentions } from '#utils/casino.js';
import { formatRupiah, parseCurrencyAmount } from '#utils/currency.js';
import { registerCancellableSession, unregisterCancellableSessionByUser } from '#utils/cancellationManager.js';
import { prisma } from '#db.js';
import {
    registerBankAccount,
    depositToBank,
    withdrawFromBank,
    validateTransferPreconditions,
    executeTransfer,
    getBankStatement,
    BANK_TRANSFER_FEE
} from '#services/bankService.js';
import { getTranslator, getChatLanguage } from '#utils/i18n.js';

export interface PendingTransfer {
    senderAccountNumber: string;
    senderUserJid: string;
    targetAccountNumber: string;
    targetUserJid: string;
    targetName: string;
    amount: number;
    fee: number;
    remoteJid: string;
    createdAt: number;
}

// In-memory map of pending transfer confirmations keyed by clean sender user ID
const pendingTransfers = new Map<string, PendingTransfer>();
const TRANSFER_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes confirmation timeout

export function getPendingTransfer(userJid: string, remoteJid?: string): PendingTransfer | undefined {
    const cleaned = cleanId(userJid);
    const pending = pendingTransfers.get(cleaned);
    if (!pending) return undefined;
    if (Date.now() - pending.createdAt > TRANSFER_TIMEOUT_MS) {
        pendingTransfers.delete(cleaned);
        return undefined;
    }
    if (remoteJid && cleanId(pending.remoteJid) !== cleanId(remoteJid)) {
        return undefined;
    }
    return pending;
}

export function clearPendingTransfer(userJid: string, remoteJid?: string): boolean {
    const cleaned = cleanId(userJid);
    const pending = pendingTransfers.get(cleaned);
    if (!pending) return false;
    if (remoteJid && cleanId(pending.remoteJid) !== cleanId(remoteJid)) {
        return false;
    }
    const chatJid = remoteJid || pending.remoteJid;
    if (chatJid) {
        unregisterCancellableSessionByUser(cleaned, chatJid);
    }
    return pendingTransfers.delete(cleaned);
}

/**
 * Intercepts incoming messages to process 'confirm' for pending bank transfers.
 * Returns true if handled.
 */
export async function processBankTransferConfirmation(
    sock: any,
    msg: any,
    senderRaw: string,
    chatJid: string,
    text: string,
    t: (key: string, args?: Record<string, any>) => string
): Promise<boolean> {
    const lower = text.trim().toLowerCase();
    if (lower !== 'confirm' && lower !== 'konfirmasi' && lower !== 'yes' && lower !== 'ya') {
        return false;
    }

    const pending = getPendingTransfer(senderRaw, chatJid);
    if (!pending) {
        return false;
    }

    // Clear session & cancellation registration
    clearPendingTransfer(senderRaw, chatJid);

    // Execute transfer atomically
    const result = await executeTransfer(pending.senderAccountNumber, pending.targetAccountNumber, pending.amount, t);

    if (!result.success) {
        await sock.sendMessage(chatJid, { text: result.error || 'Transaction failed.' }, { quoted: msg });
        return true;
    }

    // 1. Reply to sender
    const senderSuccessMsg = t('tools.bank.transfer_sender_success', {
        amount: formatRupiah(pending.amount),
        targetAccount: pending.targetAccountNumber,
        newBankBalance: formatRupiah(result.newBankBalance ?? 0)
    });
    await sock.sendMessage(chatJid, { text: senderSuccessMsg }, { quoted: msg });

    // 2. Asynchronously notify recipient in background (fire-and-forget, do not delay sender)
    const targetUserJidRaw = result.targetUserJid;
    if (targetUserJidRaw) {
        (async () => {
            try {
                const targetJids = formatMentions(targetUserJidRaw);
                const targetJid =
                    targetJids[0] ||
                    (targetUserJidRaw.includes('@') ? targetUserJidRaw : `${targetUserJidRaw}@s.whatsapp.net`);
                const receiverLang = await getChatLanguage(targetJid);
                const receiverT = getTranslator(receiverLang);
                const notification = receiverT('tools.bank.transfer_receiver_notification', {
                    amount: formatRupiah(pending.amount),
                    senderAccount: pending.senderAccountNumber,
                    senderName: msg.pushName || pending.senderUserJid.split('@')[0]
                });
                await sock.sendMessage(targetJid, { text: notification });
            } catch (err) {
                console.error('[Bank] Error sending async recipient notification:', err);
            }
        })().catch(() => {});
    }

    return true;
}

export const definition: ToolDefinition = {
    name: 'bank',
    title: 'Cosmos Central Bank',
    category: 'Economy',
    aliases: ['atm', 'rekening', 'centralbank'],
    description: 'Cosmos Central Bank system for secure savings, transfers, and balance inquiries.',
    descriptionKey: 'tools.commands.bank.description',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Bank action: register, balance, deposit, withdraw, transfer'
            },
            account: {
                type: 'string',
                description: 'Target bank account number for transfer'
            },
            amount: {
                type: 'string',
                description: 'Amount for deposit, withdraw, or transfer'
            }
        }
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string | void> {
    const t = ctx?.t || getTranslator('en');
    const senderJid = getSenderJid(ctx.msg, ctx.sock);
    if (!senderJid) {
        return t('tools.bank.sender_identity_error');
    }

    const rawText = (ctx.msg.message?.conversation || ctx.msg.message?.extendedTextMessage?.text || '').trim();
    // Parse arguments from raw text: .bank <subcommand> [params...]
    const parts = rawText.split(/\s+/);
    // If invoked as .bank, parts[0] is .bank, parts[1] is subcommand
    const subCommand = (parts[1] || args.action || '').toLowerCase();
    const remainingParts = parts.slice(2);

    switch (subCommand) {
        case 'register':
        case 'daftar':
        case 'open': {
            const result = await registerBankAccount(senderJid, ctx.msg.pushName || undefined, t);
            if (!result.success) {
                return result.error;
            }
            return t('tools.bank.register_success', {
                accountNumber: result.accountNumber
            });
        }

        case 'deposit':
        case 'depo':
        case 'nabung':
        case 'setor': {
            const amountInput = remainingParts[0] || args.amount || '';
            const user = await getUser(prisma as any, senderJid, ctx.msg.pushName || undefined);
            const amount = parseCurrencyAmount(amountInput, user?.balance);

            if (amount === null || amount <= 0) {
                return t('tools.bank.deposit_invalid_amount');
            }

            const result = await depositToBank(senderJid, amount, t);
            if (!result.success) {
                return result.error;
            }

            return t('tools.bank.deposit_success', {
                amount: formatRupiah(amount),
                newBankBalance: formatRupiah(result.newBankBalance ?? 0)
            });
        }

        case 'withdraw':
        case 'wd':
        case 'tarik': {
            const amountInput = remainingParts[0] || args.amount || '';
            const statement = await getBankStatement(senderJid);
            const bankBalance = statement ? statement.bankBalance : undefined;
            const amount = parseCurrencyAmount(amountInput, bankBalance);

            if (amount === null || amount <= 0) {
                return t('tools.bank.withdrawal_invalid_amount');
            }

            const result = await withdrawFromBank(senderJid, amount, t);
            if (!result.success) {
                return result.error;
            }

            return t('tools.bank.withdrawal_success', {
                amount: formatRupiah(amount),
                newBankBalance: formatRupiah(result.newBankBalance ?? 0)
            });
        }

        case 'transfer':
        case 'tf':
        case 'kirim': {
            // Format: .bank transfer <account_number> <amount>
            const targetAccountInput = remainingParts[0] || args.account || '';
            const amountInput = remainingParts[1] || args.amount || '';

            if (!targetAccountInput || !amountInput) {
                return t('tools.bank.transfer_usage');
            }

            const statement = await getBankStatement(senderJid);
            const bankBalance = statement ? statement.bankBalance : undefined;
            const amount = parseCurrencyAmount(amountInput, bankBalance);

            if (amount === null || amount <= 0) {
                return t('tools.bank.transfer_invalid_amount');
            }

            // Check if user already has an active pending confirmation
            const cleanedSender = cleanId(senderJid);
            if (getPendingTransfer(cleanedSender, ctx.jid)) {
                return t('tools.bank.transfer_pending_exists');
            }

            // Validate preconditions
            const validation = await validateTransferPreconditions(senderJid, targetAccountInput, amount, t);

            if (!validation.valid || !validation.senderAccount || !validation.targetAccount) {
                return validation.error;
            }

            // Save pending transfer
            const pending: PendingTransfer = {
                senderAccountNumber: validation.senderAccount.accountNumber,
                senderUserJid: senderJid,
                targetAccountNumber: validation.targetAccount.accountNumber,
                targetUserJid: validation.targetAccount.userJid,
                targetName: validation.targetAccount.fullName,
                amount,
                fee: BANK_TRANSFER_FEE,
                remoteJid: ctx.jid,
                createdAt: Date.now()
            };
            pendingTransfers.set(cleanedSender, pending);

            // Register into global cancellationManager so typing .cancel aborts the pending transfer
            registerCancellableSession({
                sessionId: `bank_tf_${cleanedSender}`,
                feature: 'bank',
                userJid: cleanedSender,
                chatJid: ctx.jid,
                description: 'bank transfer',
                onCancel: async () => {
                    pendingTransfers.delete(cleanedSender);
                    return t('tools.bank.transfer_cancelled');
                }
            });

            // Prompt user for confirmation
            return t('tools.bank.transfer_confirm_prompt', {
                amount: formatRupiah(amount),
                targetAccount: validation.targetAccount.accountNumber,
                targetName: validation.targetAccount.fullName,
                fee: formatRupiah(BANK_TRANSFER_FEE)
            });
        }

        case 'balance':
        case 'bal':
        case 'saldo':
        case 'info':
        case 'statement':
        case 'mutasi': {
            const statement = await getBankStatement(senderJid);
            if (!statement) {
                return t('tools.bank.account_not_found');
            }

            const lines: string[] = [
                t('tools.bank.statement_header'),
                t('tools.bank.statement_holder', { fullName: statement.fullName }),
                t('tools.bank.statement_account', { accountNumber: statement.accountNumber }),
                t('tools.bank.statement_balance', { bankBalance: formatRupiah(statement.bankBalance) }),
                t('tools.bank.statement_recent_title')
            ];

            if (statement.transactions.length === 0) {
                lines.push(t('tools.bank.statement_no_transactions'));
            } else {
                statement.transactions.forEach((tx, idx) => {
                    const sign =
                        tx.type === 'DEPOSIT' || tx.type === 'TRANSFER_IN' || tx.type === 'INTEREST' ? '+' : '-';
                    const dateStr = new Date(tx.timestamp).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                    });
                    lines.push(`  ${idx + 1}. [${tx.type}] ${sign}${formatRupiah(tx.amount)} (${dateStr})`);
                });
            }

            lines.push(t('tools.bank.statement_footer'));
            return lines.join('\n');
        }

        default: {
            return t('tools.bank.usage');
        }
    }
}

const bankTool: ToolModule = {
    definition,
    execute
};

export default bankTool;
