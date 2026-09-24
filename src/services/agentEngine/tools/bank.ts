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

        // For withdraw and transfer: require explicit interactive confirmation
        if (action === 'withdraw' || action === 'transfer') {
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
