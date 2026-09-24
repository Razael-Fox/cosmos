import { AgentTool, AgentExecutionContext, ToolExecutionResult, ToolAiPolicy } from '../types.js';
import { prisma } from '../../../db.js';
import { formatRupiah } from '../../../utils/currency.js';
import { getUser } from '../../../utils/casino.js';

export const bankTool: AgentTool = {
    name: 'bank_action',
    description: 'Performs banking operations: deposit cash into savings, or requests a withdrawal/transfer.',
    policy: ToolAiPolicy.CONFIRMATION_REQUIRED,
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['deposit', 'withdraw', 'transfer'],
                description: 'The banking action to perform.'
            },
            amount: {
                type: 'number',
                description: 'The amount in Rupiah to deposit, withdraw, or transfer.'
            },
            targetAccount: {
                type: 'string',
                description: 'Target account number or recipient identifier for transfers.'
            }
        },
        required: ['action', 'amount']
    },
    execute: async (args: Record<string, unknown>, ctx: AgentExecutionContext): Promise<ToolExecutionResult> => {
        const action = typeof args.action === 'string' ? args.action.toLowerCase() : '';
        const amount = typeof args.amount === 'number' ? Math.floor(args.amount) : Math.floor(Number(args.amount));
        const targetAccount = typeof args.targetAccount === 'string' ? args.targetAccount.trim() : undefined;

        if (!action || isNaN(amount) || amount <= 0) {
            return {
                success: false,
                error: 'Invalid bank action parameters. Amount must be a positive integer.'
            };
        }

        await getUser(prisma, ctx.callerJid);
        const user = await prisma.user.findUnique({
            where: { id: ctx.callerJid },
            include: { bankAccount: true }
        });

        if (!user || !user.bankAccount) {
            return {
                success: false,
                error: 'You do not have an active bank account. Please create one with .bank register.'
            };
        }

        if (user.bankAccount.status === 'FROZEN') {
            return {
                success: false,
                error: 'Your bank account is currently frozen due to outstanding obligations.'
            };
        }

        // For withdraw and transfer: require explicit interactive confirmation unless _confirmed is true
        if ((action === 'withdraw' || action === 'transfer') && !args._confirmed) {
            const formatted = formatRupiah(amount);
            const prompt =
                action === 'withdraw'
                    ? `Are you sure you want to withdraw ${formatted} from your bank account to your wallet? Please reply with *.confirm* to proceed or *.cancel* to abort.`
                    : `Are you sure you want to transfer ${formatted} to account ${targetAccount || 'specified'}? Please reply with *.confirm* to proceed or *.cancel* to abort.`;

            return {
                success: true,
                requiresConfirmation: true,
                confirmationPrompt: prompt,
                data: {
                    action,
                    amount,
                    targetAccount,
                    prompt
                }
            };
        }

        if (action === 'withdraw') {
            if (Number(user.bankAccount.balance) < amount) {
                return {
                    success: false,
                    error: `Insufficient bank balance. You have ${formatRupiah(Number(user.bankAccount.balance))}, but attempted to withdraw ${formatRupiah(amount)}.`
                };
            }

            try {
                const updated = await prisma.$transaction(async (tx) => {
                    const freshAccount = await tx.bankAccount.findUnique({
                        where: { accountNumber: user.bankAccount!.accountNumber }
                    });

                    if (!freshAccount || freshAccount.status !== 'ACTIVE' || Number(freshAccount.balance) < amount) {
                        throw new Error('INSUFFICIENT_BANK_BALANCE');
                    }

                    const newBank = BigInt(freshAccount.balance) - BigInt(amount);
                    const freshUser = await tx.user.findUnique({ where: { id: ctx.callerJid } });
                    const newWallet = BigInt(freshUser?.balance ?? 0) + BigInt(amount);

                    await tx.bankAccount.update({
                        where: { accountNumber: freshAccount.accountNumber },
                        data: { balance: newBank }
                    });

                    await tx.user.update({
                        where: { id: ctx.callerJid },
                        data: { balance: newWallet }
                    });

                    await tx.bankTransaction.create({
                        data: {
                            accountNumber: freshAccount.accountNumber,
                            type: 'WITHDRAWAL',
                            amount: BigInt(amount),
                            description: 'Agent Engine Cash Withdrawal'
                        }
                    });

                    await tx.activityLog.create({
                        data: {
                            userId: ctx.callerJid,
                            type: 'WITHDRAWAL',
                            amount: BigInt(amount),
                            description: `Agent cash withdrawal of ${formatRupiah(amount)}`
                        }
                    });

                    return {
                        newWallet: Number(newWallet),
                        newBank: Number(newBank)
                    };
                });

                return {
                    success: true,
                    data: {
                        action: 'withdraw',
                        amount,
                        newWalletBalance: updated.newWallet,
                        newBankBalance: updated.newBank,
                        formattedWallet: formatRupiah(updated.newWallet),
                        formattedBank: formatRupiah(updated.newBank)
                    }
                };
            } catch (err: unknown) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                return {
                    success: false,
                    error: `Withdrawal failed: ${errorMsg}`
                };
            }
        }

        if (action === 'transfer') {
            if (!targetAccount) {
                return {
                    success: false,
                    error: 'Target account number is required for bank transfers.'
                };
            }

            const cleanTarget = targetAccount.replace(/\D/g, '');
            if (!cleanTarget) {
                return {
                    success: false,
                    error: `Invalid target account number: "${targetAccount}".`
                };
            }

            if (cleanTarget === user.bankAccount.accountNumber) {
                return {
                    success: false,
                    error: 'You cannot transfer funds to your own bank account.'
                };
            }

            const BANK_TRANSFER_FEE = 500;
            const totalRequired = amount + BANK_TRANSFER_FEE;

            if (Number(user.bankAccount.balance) < totalRequired) {
                return {
                    success: false,
                    error: `Insufficient bank balance. You need ${formatRupiah(totalRequired)} (including ${formatRupiah(BANK_TRANSFER_FEE)} admin fee), but your balance is ${formatRupiah(Number(user.bankAccount.balance))}.`
                };
            }

            try {
                const updated = await prisma.$transaction(async (tx) => {
                    const freshSender = await tx.bankAccount.findUnique({
                        where: { accountNumber: user.bankAccount!.accountNumber }
                    });

                    if (
                        !freshSender ||
                        freshSender.status !== 'ACTIVE' ||
                        Number(freshSender.balance) < totalRequired
                    ) {
                        throw new Error('INSUFFICIENT_BANK_FUNDS');
                    }

                    const freshTarget = await tx.bankAccount.findUnique({
                        where: { accountNumber: cleanTarget },
                        include: {
                            user: {
                                include: { idCard: true }
                            }
                        }
                    });

                    if (!freshTarget || freshTarget.status !== 'ACTIVE') {
                        throw new Error('TARGET_ACCOUNT_NOT_FOUND_OR_FROZEN');
                    }

                    const newSenderBalance = BigInt(freshSender.balance) - BigInt(totalRequired);
                    const newTargetBalance = BigInt(freshTarget.balance) + BigInt(amount);

                    await tx.bankAccount.update({
                        where: { accountNumber: freshSender.accountNumber },
                        data: { balance: newSenderBalance }
                    });

                    await tx.bankAccount.update({
                        where: { accountNumber: freshTarget.accountNumber },
                        data: { balance: newTargetBalance }
                    });
                    await tx.bankTransaction.create({
                        data: {
                            accountNumber: freshSender.accountNumber,
                            type: 'TRANSFER_OUT',
                            amount: BigInt(amount),
                            relatedAccount: freshTarget.accountNumber,
                            description: `Agent Bank Transfer to ${freshTarget.accountNumber}`
                        }
                    });

                    await tx.bankTransaction.create({
                        data: {
                            accountNumber: freshSender.accountNumber,
                            type: 'FEE',
                            amount: BigInt(BANK_TRANSFER_FEE),
                            relatedAccount: freshTarget.accountNumber,
                            description: `Transfer Admin Fee to ${freshTarget.accountNumber}`
                        }
                    });

                    await tx.bankTransaction.create({
                        data: {
                            accountNumber: freshTarget.accountNumber,
                            type: 'TRANSFER_IN',
                            amount: BigInt(amount),
                            relatedAccount: freshSender.accountNumber,
                            description: `Agent Bank Transfer from ${freshSender.accountNumber}`
                        }
                    });

                    await tx.activityLog.create({
                        data: {
                            userId: ctx.callerJid,
                            type: 'TRANSFER_OUT',
                            amount: BigInt(amount),
                            description: `Agent transfer of ${formatRupiah(amount)} to ${freshTarget.accountNumber}`
                        }
                    });

                    const targetRecipientName =
                        freshTarget.user.idCard?.fullName ||
                        freshTarget.user.pushName ||
                        freshTarget.user.id.split('@')[0];

                    return {
                        newSenderBalance: Number(newSenderBalance),
                        targetRecipientName,
                        targetAccountNumber: freshTarget.accountNumber
                    };
                });

                return {
                    success: true,
                    data: {
                        action: 'transfer',
                        amount,
                        targetAccount: updated.targetAccountNumber,
                        recipientName: updated.targetRecipientName,
                        fee: BANK_TRANSFER_FEE,
                        newBankBalance: updated.newSenderBalance,
                        formattedBank: formatRupiah(updated.newSenderBalance)
                    }
                };
            } catch (err: unknown) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                return {
                    success: false,
                    error: `Transfer failed: ${errorMsg}`
                };
            }
        }

        if (action === 'deposit') {
            if (Number(user.balance) < amount) {
                return {
                    success: false,
                    error: `Insufficient wallet balance. You have ${formatRupiah(Number(user.balance))}, but attempted to deposit ${formatRupiah(amount)}.`
                };
            }

            try {
                const updated = await prisma.$transaction(async (tx) => {
                    const freshUser = await tx.user.findUnique({
                        where: { id: ctx.callerJid },
                        include: { bankAccount: true }
                    });

                    if (!freshUser || !freshUser.bankAccount || Number(freshUser.balance) < amount) {
                        throw new Error('INSUFFICIENT_FUNDS');
                    }

                    const newWallet = BigInt(freshUser.balance) - BigInt(amount);
                    const newBank = BigInt(freshUser.bankAccount.balance) + BigInt(amount);

                    await tx.user.update({
                        where: { id: ctx.callerJid },
                        data: { balance: newWallet }
                    });

                    await tx.bankAccount.update({
                        where: { accountNumber: freshUser.bankAccount.accountNumber },
                        data: { balance: newBank }
                    });

                    await tx.bankTransaction.create({
                        data: {
                            accountNumber: freshUser.bankAccount.accountNumber,
                            type: 'DEPOSIT',
                            amount: BigInt(amount),
                            description: 'Agent Engine Cash Deposit'
                        }
                    });

                    return {
                        newWallet: Number(newWallet),
                        newBank: Number(newBank)
                    };
                });

                return {
                    success: true,
                    data: {
                        action: 'deposit',
                        amount,
                        newWalletBalance: updated.newWallet,
                        newBankBalance: updated.newBank,
                        formattedWallet: formatRupiah(updated.newWallet),
                        formattedBank: formatRupiah(updated.newBank)
                    }
                };
            } catch (err: unknown) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                return {
                    success: false,
                    error: `Deposit failed: ${errorMsg}`
                };
            }
        }

        return {
            success: false,
            error: `Unsupported banking action: "${action}".`
        };
    }
};
