import { prisma } from '#db.js';
import { formatRupiah } from '#utils/currency.js';
import { getUser, cleanId } from '#utils/casino.js';
import cron from 'node-cron';

export const BANK_REGISTRATION_FEE = 10000;
export const BANK_TRANSFER_FEE = 500;
export const BANK_DAILY_TRANSFER_LIMIT = 50000000; // Rp50.000.000 daily transfer limit

export interface BankAccountDetails {
    accountNumber: string;
    userJid: string;
    balance: bigint;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    user: {
        id: string;
        pushName: string | null;
        balance: bigint;
        idCard: {
            fullName: string;
            nik: string;
        } | null;
    };
}

export interface BankStatementResult {
    accountNumber: string;
    fullName: string;
    bankBalance: bigint;
    status: string;
    transactions: Array<{
        id: string;
        type: string;
        amount: bigint;
        description: string | null;
        relatedAccount: string | null;
        timestamp: Date;
    }>;
}

export interface BankOperationResult {
    success: boolean;
    error?: string;
    accountNumber?: string;
    amount?: number;
    fee?: number;
    previousBankBalance?: bigint;
    newBankBalance?: bigint;
    cashBalance?: bigint;
    targetAccount?: string;
    targetName?: string;
    targetUserJid?: string;
}

/**
 * Generates a unique 10-digit bank account number.
 */
export async function generateAccountNumber(): Promise<string> {
    while (true) {
        // Random 10-digit number between 1000000000 and 9999999999
        const randomNum = Math.floor(1000000000 + Math.random() * 9000000000);
        const candidate = String(randomNum);

        const existing = await prisma.bankAccount.findUnique({
            where: { accountNumber: candidate }
        });
        if (!existing) {
            return candidate;
        }
    }
}

/**
 * Retrieves a user's bank account with associated user & idCard details.
 */
export async function getBankAccountByUser(userJid: string): Promise<BankAccountDetails | null> {
    const cleaned = cleanId(userJid);
    const user = await prisma.user.findFirst({
        where: {
            OR: [
                { id: userJid },
                { id: cleaned },
                { id: `${cleaned}@s.whatsapp.net` },
                { lid: userJid },
                { lid: cleaned },
                { lid: `${cleaned}@lid` }
            ]
        },
        include: {
            idCard: {
                select: {
                    fullName: true,
                    nik: true
                }
            },
            bankAccount: true
        }
    });

    if (!user || !user.bankAccount) {
        return null;
    }

    return {
        accountNumber: user.bankAccount.accountNumber,
        userJid: user.bankAccount.userJid,
        balance: user.bankAccount.balance,
        status: user.bankAccount.status,
        createdAt: user.bankAccount.createdAt,
        updatedAt: user.bankAccount.updatedAt,
        user: {
            id: user.id,
            pushName: user.pushName,
            balance: user.balance,
            idCard: user.idCard
        }
    };
}

/**
 * Registers a new bank account for a user.
 * Requirements:
 * - User must have a verified IdCard (Virtual ID / KTP)
 * - User must not already possess an active bank account
 * - User must have at least BANK_REGISTRATION_FEE in pocket cash
 */
export async function registerBankAccount(
    userJid: string,
    pushName?: string,
    t?: (key: string, args?: Record<string, any>) => string
): Promise<BankOperationResult> {
    // 1. Check if user exists & has ID Card
    const user = await getUser(prisma as any, userJid, pushName);
    const idCard = await prisma.idCard.findUnique({
        where: { userJid: user.id }
    });

    if (!idCard) {
        return {
            success: false,
            error: t
                ? t('tools.bank.no_id_card')
                : 'Access denied. You must register for a Virtual ID (KTP) before you can open a bank account.'
        };
    }

    // 2. Check if user already has a bank account
    const existingAccount = await prisma.bankAccount.findUnique({
        where: { userJid: user.id }
    });

    if (existingAccount) {
        return {
            success: false,
            accountNumber: existingAccount.accountNumber,
            error: t
                ? t('tools.bank.already_registered', { accountNumber: existingAccount.accountNumber })
                : `You already possess an active bank account. Your Account Number is ${existingAccount.accountNumber}.`
        };
    }

    // 3. Check registration fee
    if (Number(user.balance) < BANK_REGISTRATION_FEE) {
        return {
            success: false,
            error: t
                ? t('tools.bank.registration_fee_insufficient', {
                      fee: formatRupiah(BANK_REGISTRATION_FEE),
                      cashBalance: formatRupiah(user.balance)
                  })
                : `Registration failed. Opening a bank account requires a setup fee of ${formatRupiah(BANK_REGISTRATION_FEE)}. Your current cash balance is ${formatRupiah(user.balance)}.`
        };
    }

    const accountNumber = await generateAccountNumber();

    // 4. ACID Transaction: Deduct pocket balance, create BankAccount, log fee transaction
    const result = await prisma.$transaction(async (tx) => {
        const freshUser = await tx.user.findUnique({ where: { id: user.id } });
        if (!freshUser || Number(freshUser.balance) < BANK_REGISTRATION_FEE) {
            throw new Error('INSUFFICIENT_FUNDS');
        }

        await tx.user.update({
            where: { id: user.id },
            data: { balance: { decrement: BANK_REGISTRATION_FEE } }
        });

        const bankAccount = await tx.bankAccount.create({
            data: {
                accountNumber,
                userJid: user.id,
                balance: BigInt(0),
                status: 'ACTIVE'
            }
        });

        await tx.bankTransaction.create({
            data: {
                accountNumber,
                type: 'FEE',
                amount: BigInt(BANK_REGISTRATION_FEE),
                description: 'Initial account opening setup fee'
            }
        });

        return bankAccount;
    });

    return {
        success: true,
        accountNumber: result.accountNumber,
        fee: BANK_REGISTRATION_FEE
    };
}

/**
 * Deposits funds from pocket cash into the bank account.
 */
export async function depositToBank(
    userJid: string,
    amount: number,
    t?: (key: string, args?: Record<string, any>) => string
): Promise<BankOperationResult> {
    if (amount <= 0 || !Number.isInteger(amount)) {
        return {
            success: false,
            error: t
                ? t('tools.bank.deposit_invalid_amount')
                : 'Invalid deposit amount. Please specify a valid amount greater than 0.'
        };
    }

    const bankAccount = await getBankAccountByUser(userJid);
    if (!bankAccount) {
        return {
            success: false,
            error: t
                ? t('tools.bank.account_not_found')
                : 'You do not have an active bank account yet. Please register first using *.bank register*.'
        };
    }

    if (bankAccount.status !== 'ACTIVE') {
        return {
            success: false,
            error: t
                ? t('tools.bank.account_frozen', { status: bankAccount.status })
                : `Your bank account is currently ${bankAccount.status}. Please contact administration.`
        };
    }

    const userId = bankAccount.user.id;

    try {
        const updated = await prisma.$transaction(async (tx) => {
            const freshUser = await tx.user.findUnique({ where: { id: userId } });
            if (!freshUser || Number(freshUser.balance) < amount) {
                throw new Error('INSUFFICIENT_CASH');
            }

            await tx.user.update({
                where: { id: userId },
                data: { balance: { decrement: amount } }
            });

            const freshAccount = await tx.bankAccount.update({
                where: { accountNumber: bankAccount.accountNumber },
                data: { balance: { increment: amount } }
            });

            await tx.bankTransaction.create({
                data: {
                    accountNumber: bankAccount.accountNumber,
                    type: 'DEPOSIT',
                    amount: BigInt(amount),
                    description: 'Cash deposit via ATM / Teller'
                }
            });

            await tx.activityLog.create({
                data: {
                    userId,
                    type: 'DEPOSIT',
                    amount: BigInt(amount),
                    description: `Cash deposit of ${formatRupiah(amount)}`
                }
            });

            return freshAccount;
        });

        return {
            success: true,
            accountNumber: updated.accountNumber,
            amount,
            newBankBalance: updated.balance
        };
    } catch (err: any) {
        if (err.message === 'INSUFFICIENT_CASH') {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            return {
                success: false,
                cashBalance: user?.balance ?? BigInt(0),
                error: t
                    ? t('tools.bank.insufficient_cash', { cashBalance: formatRupiah(user?.balance ?? 0) })
                    : `Transaction failed. You do not have sufficient cash on hand. Your current cash balance is ${formatRupiah(user?.balance ?? 0)}.`
            };
        }
        return {
            success: false,
            error: t ? t('tools.bank.transaction_failed') : 'Transaction failed.'
        };
    }
}

/**
 * Withdraws funds from bank account to pocket cash.
 */
export async function withdrawFromBank(
    userJid: string,
    amount: number,
    t?: (key: string, args?: Record<string, any>) => string
): Promise<BankOperationResult> {
    if (amount <= 0 || !Number.isInteger(amount)) {
        return {
            success: false,
            error: t
                ? t('tools.bank.withdrawal_invalid_amount')
                : 'Invalid withdrawal amount. Please specify a valid amount greater than 0.'
        };
    }

    const bankAccount = await getBankAccountByUser(userJid);
    if (!bankAccount) {
        return {
            success: false,
            error: t
                ? t('tools.bank.account_not_found')
                : 'You do not have an active bank account yet. Please register first using *.bank register*.'
        };
    }

    if (bankAccount.status !== 'ACTIVE') {
        return {
            success: false,
            error: t
                ? t('tools.bank.account_frozen', { status: bankAccount.status })
                : `Your bank account is currently ${bankAccount.status}. Please contact administration.`
        };
    }

    const userId = bankAccount.user.id;

    try {
        const updated = await prisma.$transaction(async (tx) => {
            const freshAccount = await tx.bankAccount.findUnique({
                where: { accountNumber: bankAccount.accountNumber }
            });
            if (!freshAccount || Number(freshAccount.balance) < amount) {
                throw new Error('INSUFFICIENT_BANK_BALANCE');
            }

            const updatedAccount = await tx.bankAccount.update({
                where: { accountNumber: bankAccount.accountNumber },
                data: { balance: { decrement: amount } }
            });

            await tx.user.update({
                where: { id: userId },
                data: { balance: { increment: amount } }
            });

            await tx.bankTransaction.create({
                data: {
                    accountNumber: bankAccount.accountNumber,
                    type: 'WITHDRAWAL',
                    amount: BigInt(amount),
                    description: 'Cash withdrawal via ATM / Teller'
                }
            });

            await tx.activityLog.create({
                data: {
                    userId,
                    type: 'WITHDRAWAL',
                    amount: BigInt(amount),
                    description: `Cash withdrawal of ${formatRupiah(amount)}`
                }
            });

            return updatedAccount;
        });

        return {
            success: true,
            accountNumber: updated.accountNumber,
            amount,
            newBankBalance: updated.balance
        };
    } catch (err: any) {
        if (err.message === 'INSUFFICIENT_BANK_BALANCE') {
            return {
                success: false,
                error: t
                    ? t('tools.bank.insufficient_bank_balance', { bankBalance: formatRupiah(bankAccount.balance) })
                    : `Transaction failed. Your bank account does not have sufficient funds for this withdrawal. Your current bank balance is ${formatRupiah(bankAccount.balance)}.`
            };
        }
        return {
            success: false,
            error: t ? t('tools.bank.transaction_failed') : 'Transaction failed.'
        };
    }
}

/**
 * Calculates total outbound transfers executed by an account in the current calendar day (UTC/Local day).
 */
export async function getDailyTransferTotal(accountNumber: string): Promise<bigint> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const transactions = await prisma.bankTransaction.findMany({
        where: {
            accountNumber,
            type: 'TRANSFER_OUT',
            timestamp: {
                gte: startOfDay
            }
        }
    });

    return transactions.reduce((acc, curr) => acc + curr.amount, BigInt(0));
}

/**
 * Validates a pending transfer before asking for confirmation.
 */
export async function validateTransferPreconditions(
    senderJid: string,
    targetAccountNumber: string,
    amount: number,
    t?: (key: string, args?: Record<string, any>) => string
): Promise<{
    valid: boolean;
    error?: string;
    senderAccount?: BankAccountDetails;
    targetAccount?: {
        accountNumber: string;
        userJid: string;
        status: string;
        fullName: string;
    };
    totalDeduction?: number;
}> {
    if (amount <= 0 || !Number.isInteger(amount)) {
        return {
            valid: false,
            error: t
                ? t('tools.bank.transfer_invalid_amount')
                : 'Invalid transfer amount. Please specify a valid amount greater than 0.'
        };
    }

    const senderAccount = await getBankAccountByUser(senderJid);
    if (!senderAccount) {
        return {
            valid: false,
            error: t
                ? t('tools.bank.account_not_found')
                : 'You do not have an active bank account yet. Please register first using *.bank register*.'
        };
    }

    if (senderAccount.status !== 'ACTIVE') {
        return {
            valid: false,
            error: t
                ? t('tools.bank.account_frozen', { status: senderAccount.status })
                : `Your bank account is currently ${senderAccount.status}. Please contact administration.`
        };
    }

    const cleanTarget = targetAccountNumber.trim();
    if (cleanTarget === senderAccount.accountNumber) {
        return {
            valid: false,
            error: t
                ? t('tools.bank.transfer_self')
                : 'Transaction failed. You cannot transfer funds to your own bank account.'
        };
    }

    const target = await prisma.bankAccount.findUnique({
        where: { accountNumber: cleanTarget },
        include: {
            user: {
                include: {
                    idCard: true
                }
            }
        }
    });

    if (!target) {
        return {
            valid: false,
            error: t
                ? t('tools.bank.transfer_target_not_found', { targetAccount: cleanTarget })
                : `Transaction failed. The specified target Account Number (${cleanTarget}) does not exist.`
        };
    }

    if (target.status !== 'ACTIVE') {
        return {
            valid: false,
            error: t
                ? t('tools.bank.transfer_target_frozen', { status: target.status })
                : `Transaction failed. The recipient bank account is currently ${target.status}.`
        };
    }

    const totalRequired = amount + BANK_TRANSFER_FEE;
    if (Number(senderAccount.balance) < totalRequired) {
        return {
            valid: false,
            error: t
                ? t('tools.bank.transfer_insufficient_funds', { fee: formatRupiah(BANK_TRANSFER_FEE) })
                : 'Transaction failed. You do not have sufficient funds in your bank account to complete this transfer.'
        };
    }

    // Check daily transfer limit
    const dailyTotal = await getDailyTransferTotal(senderAccount.accountNumber);
    if (Number(dailyTotal) + amount > BANK_DAILY_TRANSFER_LIMIT) {
        const remaining = Math.max(0, BANK_DAILY_TRANSFER_LIMIT - Number(dailyTotal));
        return {
            valid: false,
            error: t
                ? t('tools.bank.transfer_limit_exceeded', {
                      limit: formatRupiah(BANK_DAILY_TRANSFER_LIMIT),
                      remaining: formatRupiah(remaining)
                  })
                : `Transaction failed. This transfer exceeds your daily transfer limit of ${formatRupiah(BANK_DAILY_TRANSFER_LIMIT)}.`
        };
    }

    const targetName = target.user.idCard?.fullName || target.user.pushName || target.user.id.split('@')[0];

    return {
        valid: true,
        senderAccount,
        targetAccount: {
            accountNumber: target.accountNumber,
            userJid: target.userJid,
            status: target.status,
            fullName: targetName
        },
        totalDeduction: totalRequired
    };
}

/**
 * Commits a validated bank transfer atomically.
 */
export async function executeTransfer(
    senderAccountNumber: string,
    targetAccountNumber: string,
    amount: number,
    t?: (key: string, args?: Record<string, any>) => string
): Promise<BankOperationResult> {
    try {
        const result = await prisma.$transaction(async (tx) => {
            const totalRequired = amount + BANK_TRANSFER_FEE;

            // Sender check & lock
            const sender = await tx.bankAccount.findUnique({
                where: { accountNumber: senderAccountNumber }
            });
            if (!sender || sender.status !== 'ACTIVE' || Number(sender.balance) < totalRequired) {
                throw new Error('INSUFFICIENT_BANK_FUNDS');
            }

            // Target check & lock
            const target = await tx.bankAccount.findUnique({
                where: { accountNumber: targetAccountNumber },
                include: {
                    user: {
                        include: {
                            idCard: true
                        }
                    }
                }
            });
            if (!target || target.status !== 'ACTIVE') {
                throw new Error('INVALID_TARGET');
            }

            // Deduct from sender
            const updatedSender = await tx.bankAccount.update({
                where: { accountNumber: senderAccountNumber },
                data: { balance: { decrement: totalRequired } }
            });

            // Credit to target
            await tx.bankAccount.update({
                where: { accountNumber: targetAccountNumber },
                data: { balance: { increment: amount } }
            });

            // Transactions: TRANSFER_OUT for sender
            await tx.bankTransaction.create({
                data: {
                    accountNumber: senderAccountNumber,
                    type: 'TRANSFER_OUT',
                    amount: BigInt(amount),
                    relatedAccount: targetAccountNumber,
                    description: `Transfer to ${targetAccountNumber}`
                }
            });

            // Transactions: FEE for sender
            await tx.bankTransaction.create({
                data: {
                    accountNumber: senderAccountNumber,
                    type: 'FEE',
                    amount: BigInt(BANK_TRANSFER_FEE),
                    relatedAccount: targetAccountNumber,
                    description: 'Inter-account transfer fee'
                }
            });

            // Transactions: TRANSFER_IN for receiver
            await tx.bankTransaction.create({
                data: {
                    accountNumber: targetAccountNumber,
                    type: 'TRANSFER_IN',
                    amount: BigInt(amount),
                    relatedAccount: senderAccountNumber,
                    description: `Transfer from ${senderAccountNumber}`
                }
            });

            const targetName = target.user.idCard?.fullName || target.user.pushName || target.user.id.split('@')[0];

            return {
                updatedSender,
                targetUserJid: target.userJid,
                targetName
            };
        });

        return {
            success: true,
            accountNumber: senderAccountNumber,
            targetAccount: targetAccountNumber,
            targetName: result.targetName,
            targetUserJid: result.targetUserJid,
            amount,
            fee: BANK_TRANSFER_FEE,
            newBankBalance: result.updatedSender.balance
        };
    } catch (err: any) {
        if (err.message === 'INSUFFICIENT_BANK_FUNDS') {
            return {
                success: false,
                error: t
                    ? t('tools.bank.insufficient_bank_balance')
                    : 'Transaction failed. You do not have sufficient funds in your bank account to complete this transfer.'
            };
        }
        if (err.message === 'INVALID_TARGET') {
            return {
                success: false,
                error: t
                    ? t('tools.bank.transfer_target_not_found', { targetAccount: targetAccountNumber })
                    : `Transaction failed. The specified target Account Number (${targetAccountNumber}) does not exist.`
            };
        }
        return {
            success: false,
            error: t ? t('tools.bank.transaction_failed') : 'Transaction failed.'
        };
    }
}

/**
 * Retrieves the mini statement and balance summary for an account.
 */
export async function getBankStatement(userJid: string): Promise<BankStatementResult | null> {
    const bankAccount = await getBankAccountByUser(userJid);
    if (!bankAccount) {
        return null;
    }

    const recentTransactions = await prisma.bankTransaction.findMany({
        where: { accountNumber: bankAccount.accountNumber },
        orderBy: { timestamp: 'desc' },
        take: 5
    });

    const fullName =
        bankAccount.user.idCard?.fullName || bankAccount.user.pushName || bankAccount.user.id.split('@')[0];

    return {
        accountNumber: bankAccount.accountNumber,
        fullName,
        bankBalance: bankAccount.balance,
        status: bankAccount.status,
        transactions: recentTransactions
    };
}

/**
 * Distributes daily interest to active accounts with positive balances.
 * Rate: 0.05% per day (annualized ~18.25%), capped to prevent hyperinflation.
 */
export async function distributeDailyInterest(): Promise<{ accountsProcessed: number; totalInterestPaid: bigint }> {
    const activeAccounts = await prisma.bankAccount.findMany({
        where: {
            status: 'ACTIVE',
            balance: {
                gt: BigInt(0)
            }
        }
    });

    let accountsProcessed = 0;
    let totalInterestPaid = BigInt(0);

    for (const acc of activeAccounts) {
        // Daily rate: 0.05% (5 basis points)
        // interest = floor(balance * 0.0005)
        const balanceNum = Number(acc.balance);
        const interestAmount = Math.floor(balanceNum * 0.0005);

        if (interestAmount <= 0) continue;

        try {
            await prisma.$transaction(async (tx) => {
                await tx.bankAccount.update({
                    where: { accountNumber: acc.accountNumber },
                    data: { balance: { increment: interestAmount } }
                });

                await tx.bankTransaction.create({
                    data: {
                        accountNumber: acc.accountNumber,
                        type: 'INTEREST',
                        amount: BigInt(interestAmount),
                        description: 'Daily compound interest credit (0.05%)'
                    }
                });
            });

            accountsProcessed++;
            totalInterestPaid += BigInt(interestAmount);
        } catch (err) {
            console.error(`[BankService] Failed to distribute interest to account ${acc.accountNumber}:`, err);
        }
    }

    console.log(
        `[BankService] Daily interest distribution complete: credited ${formatRupiah(totalInterestPaid)} across ${accountsProcessed} accounts.`
    );
    return { accountsProcessed, totalInterestPaid };
}

/**
 * Starts the background cron job that distributes daily bank interest at 00:00 WIB daily.
 */
export function startBankInterestCron(): void {
    cron.schedule(
        '0 0 * * *',
        async () => {
            console.log('[BankService] Starting scheduled daily interest distribution...');
            try {
                await distributeDailyInterest();
            } catch (err) {
                console.error('[BankService] Error during daily interest cron:', err);
            }
        },
        {
            timezone: 'Asia/Jakarta'
        }
    );
    console.log('[BankService] Bank interest distribution cron scheduled at 00:00 WIB daily.');
}
