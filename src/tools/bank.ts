import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { getSenderJid, cleanId, getUser } from '#utils/casino.js';
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
import {
    renderCard,
    renderAlert,
    renderSyntaxError,
    renderCatalogCard,
    renderBadge,
    CatalogItem
} from '#utils/uiFormatter.js';

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
        await sock.sendMessage(
            chatJid,
            { text: renderAlert({ type: 'error', message: result.error || 'Transaction failed.' }) },
            { quoted: msg }
        );
        return true;
    }

    // 1. Reply to sender
    const senderSuccessCard = renderAlert({
        type: 'success',
        title: 'TRANSFER COMPLETED',
        message: t('tools.bank.transfer_sender_success', {
            amount: formatRupiah(pending.amount),
            targetAccount: pending.targetAccountNumber,
            newBankBalance: formatRupiah(result.newBankBalance ?? 0)
        }),
        details: [
            `Recipient: ${pending.targetName}`,
            `Target Account: ${pending.targetAccountNumber}`,
            `Transfer Amount: ${formatRupiah(pending.amount)}`,
            `Admin Fee: ${formatRupiah(pending.fee)}`,
            `Remaining Bank Balance: ${formatRupiah(result.newBankBalance ?? 0)}`
        ]
    });
    await sock.sendMessage(chatJid, { text: senderSuccessCard }, { quoted: msg });

    // 2. Asynchronously notify receiver
    if (pending.targetUserJid) {
        (async () => {
            try {
                const targetChatLanguage = await getChatLanguage(pending.targetUserJid);
                const targetT = getTranslator(targetChatLanguage);
                const receiverCard = renderAlert({
                    type: 'success',
                    title: 'FUNDS RECEIVED',
                    message: targetT('tools.bank.transfer_receiver_notification', {
                        amount: formatRupiah(pending.amount),
                        senderAccount: pending.senderAccountNumber,
                        senderName: msg.pushName || pending.senderAccountNumber
                    }),
                    details: [
                        `Amount: +${formatRupiah(pending.amount)}`,
                        `Sender: ${msg.pushName || pending.senderAccountNumber} (\`${pending.senderAccountNumber}\`)`
                    ]
                });
                await sock.sendMessage(pending.targetUserJid, { text: receiverCard });
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
    const parts = rawText.split(/\s+/);
    const subCommand = (parts[1] || args.action || '').toLowerCase();
    const remainingParts = parts.slice(2);

    switch (subCommand) {
        case 'register':
        case 'daftar':
        case 'open': {
            const result = await registerBankAccount(senderJid, ctx.msg.pushName || undefined, t);
            if (!result.success) {
                return renderAlert({ type: 'error', message: result.error! });
            }
            return renderAlert({
                type: 'success',
                title: 'BANK ACCOUNT REGISTERED',
                message: t('tools.bank.register_success', {
                    accountNumber: result.accountNumber
                }),
                details: [`Account Number: ${result.accountNumber}`, `Status: ACTIVE`]
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
                return renderSyntaxError(
                    'bank deposit',
                    t('tools.bank.deposit_invalid_amount'),
                    '.bank deposit <amount|all>',
                    '.bank deposit 500000\n• .bank deposit 1.000.000\n• .bank deposit all',
                    t
                );
            }

            const result = await depositToBank(senderJid, amount, t);
            if (!result.success) {
                return renderAlert({ type: 'error', message: result.error! });
            }

            return renderAlert({
                type: 'success',
                title: 'DEPOSIT SUCCESSFUL',
                message: t('tools.bank.deposit_success', {
                    amount: formatRupiah(amount),
                    newBankBalance: formatRupiah(result.newBankBalance ?? 0)
                }),
                details: [
                    `Deposited Amount: +${formatRupiah(amount)}`,
                    `New Bank Balance: ${formatRupiah(result.newBankBalance ?? 0)}`
                ]
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
                return renderSyntaxError(
                    'bank withdraw',
                    t('tools.bank.withdrawal_invalid_amount'),
                    '.bank withdraw <amount|all>',
                    '.bank withdraw 500000\n• .bank withdraw 1.000.000\n• .bank withdraw all',
                    t
                );
            }

            const result = await withdrawFromBank(senderJid, amount, t);
            if (!result.success) {
                return renderAlert({ type: 'error', message: result.error! });
            }

            return renderAlert({
                type: 'success',
                title: 'WITHDRAWAL SUCCESSFUL',
                message: t('tools.bank.withdrawal_success', {
                    amount: formatRupiah(amount),
                    newBankBalance: formatRupiah(result.newBankBalance ?? 0)
                }),
                details: [
                    `Withdrawn Cash: +${formatRupiah(amount)}`,
                    `Remaining Bank Balance: ${formatRupiah(result.newBankBalance ?? 0)}`
                ]
            });
        }

        case 'transfer':
        case 'tf':
        case 'kirim': {
            const targetAccountInput = remainingParts[0] || args.account || '';
            const amountInput = remainingParts[1] || args.amount || '';

            if (!targetAccountInput || !amountInput) {
                return renderSyntaxError(
                    'bank transfer',
                    t('tools.bank.transfer_usage'),
                    '.bank transfer <account_number> <amount>',
                    '.bank transfer 1234567890 500000\n• .bank transfer CCB-123456 1.000.000',
                    t
                );
            }

            const statement = await getBankStatement(senderJid);
            const bankBalance = statement ? statement.bankBalance : undefined;
            const amount = parseCurrencyAmount(amountInput, bankBalance);

            if (amount === null || amount <= 0) {
                return renderSyntaxError(
                    'bank transfer',
                    t('tools.bank.transfer_invalid_amount'),
                    '.bank transfer <account_number> <amount>',
                    '.bank transfer 1234567890 500000\n• .bank transfer CCB-123456 1.000.000',
                    t
                );
            }

            const cleanedSender = cleanId(senderJid);
            if (getPendingTransfer(cleanedSender, ctx.jid)) {
                return renderAlert({ type: 'warning', message: t('tools.bank.transfer_pending_exists') });
            }

            const validation = await validateTransferPreconditions(senderJid, targetAccountInput, amount, t);

            if (!validation.valid || !validation.senderAccount || !validation.targetAccount) {
                return renderAlert({ type: 'error', message: validation.error! });
            }

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

            return [
                renderCard({
                    title: 'TRANSFER CONFIRMATION REQUIRED',
                    icon: '⚠️',
                    headerStyle: 'light',
                    fields: [
                        { icon: '📤', label: 'Recipient', value: validation.targetAccount.fullName },
                        {
                            icon: '💳',
                            label: 'Target Account',
                            value: `\`${validation.targetAccount.accountNumber}\``
                        },
                        { icon: '💵', label: 'Amount', value: formatRupiah(amount) },
                        { icon: '🏷️', label: 'Admin Fee', value: formatRupiah(BANK_TRANSFER_FEE) },
                        {
                            icon: '💰',
                            label: 'Total Deduction',
                            value: formatRupiah(amount + BANK_TRANSFER_FEE)
                        },
                        { icon: '⏱️', label: 'Timeout', value: '3 Minutes' }
                    ]
                }),
                '',
                `👉 Type *confirm* (or *konfirmasi*) to execute this transfer.`,
                `❌ Type *.cancel* at any time to abort.`
            ].join('\n');
        }

        case 'balance':
        case 'bal':
        case 'saldo':
        case 'info':
        case 'statement':
        case 'mutasi': {
            const statement = await getBankStatement(senderJid);
            if (!statement) {
                return renderAlert({ type: 'warning', message: t('tools.bank.account_not_found') });
            }

            const headerCard = renderCard({
                title: 'COSMOS CENTRAL BANK',
                icon: '🏦',
                headerStyle: 'heavy',
                subtitle: 'Official Financial Statement',
                fields: [
                    { icon: '👤', label: 'Account Holder', value: statement.fullName },
                    { icon: '💳', label: 'Account Number', value: `\`${statement.accountNumber}\`` },
                    { icon: '🏛️', label: 'Account Status', value: renderBadge(statement.status || 'ACTIVE') },
                    { icon: '💵', label: 'Vault Balance', value: formatRupiah(statement.bankBalance) },
                    { icon: '📈', label: 'Compound Rate', value: '0.5% / Daily (Accrues at 00:00 UTC)' }
                ]
            });

            const txItems: CatalogItem[] = statement.transactions.map((tx, idx) => {
                const isPositive = tx.type === 'DEPOSIT' || tx.type === 'TRANSFER_IN' || tx.type === 'INTEREST';
                const sign = isPositive ? '+' : '-';
                const icon =
                    tx.type === 'DEPOSIT'
                        ? '🟢'
                        : tx.type === 'TRANSFER_IN'
                          ? '🔵'
                          : tx.type === 'WITHDRAW'
                            ? '🔴'
                            : '📈';
                const dateStr = new Date(tx.timestamp).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                });
                return {
                    rank: `${idx + 1}`,
                    title: `${icon} [${tx.type}] ${sign}${formatRupiah(tx.amount)}`,
                    subtitle: dateStr
                };
            });

            const txCard =
                statement.transactions.length > 0
                    ? renderCatalogCard(
                          'RECENT TRANSACTIONS',
                          '📑',
                          txItems,
                          'Transfers require interactive confirmation within 3 minutes.'
                      )
                    : renderCatalogCard('RECENT TRANSACTIONS', '📑', [
                          { title: t('tools.bank.statement_no_transactions') }
                      ]);

            return `${headerCard}\n\n${txCard}`;
        }

        default: {
            return renderCard({
                title: 'COSMOS CENTRAL BANK',
                icon: '🏦',
                headerStyle: 'heavy',
                body: [
                    'Available commands:',
                    '• *.bank register* - Open a new bank account',
                    '• *.bank balance* - View account statement & balance',
                    '• *.bank deposit <amount>* - Deposit cash to bank',
                    '• *.bank withdraw <amount>* - Withdraw cash from bank',
                    '• *.bank transfer <account> <amount>* - Transfer to another account'
                ],
                tips: ['Transfers require interactive confirmation within 3 minutes.']
            });
        }
    }
}

const bankTool: ToolModule = {
    definition,
    execute
};

export default bankTool;
