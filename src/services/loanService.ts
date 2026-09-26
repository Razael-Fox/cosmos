import { prisma } from '#db.js';
import { formatRupiah } from '#utils/currency.js';
import { getChatLanguage, getTranslator } from '#utils/i18n.js';
import { getBankAccountByUser } from '#services/bankService.js';
import cron from 'node-cron';
import 'dotenv/config';
import { getGroqClient } from '#utils/apiKeyResolver.js';
import { DecisionClient } from './agentEngine/decisionClient.js';

export interface CreditProfile {
    userId: string;
    creditScore: number;
    reputation: 'Poor' | 'Fair' | 'Good' | 'Excellent';
    maxBorrowLimit: number;
    netWorth: bigint;
    walletBalance: bigint;
    bankBalance: bigint;
    assetsValue: bigint;
    activeLoan: any | null;
    totalRepayments: number;
    totalDefaults: number;
}

export interface AiLoanAssessmentResult {
    approved: boolean;
    interestRate: number; // e.g. 0.05 for 5%
    termDays: number; // e.g. 14 or 30 days
    reasoning: string;
    maxApprovedAmount: number;
}

/**
 * Calculates a user's total net worth (wallet cash + bank balance + owned properties/items value).
 */
export async function calculateUserNetWorth(userId: string): Promise<{
    walletBalance: bigint;
    bankBalance: bigint;
    assetsValue: bigint;
    totalNetWorth: bigint;
}> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            bankAccount: true,
            inventories: {
                where: { ownershipStatus: 'Owned' },
                include: { item: true, property: true }
            }
        }
    });

    if (!user) {
        return {
            walletBalance: BigInt(0),
            bankBalance: BigInt(0),
            assetsValue: BigInt(0),
            totalNetWorth: BigInt(0)
        };
    }

    const walletBalance = user.balance;
    const bankBalance = user.bankAccount?.balance ?? BigInt(0);

    let assetsValue = BigInt(0);
    for (const inv of user.inventories) {
        if (inv.property?.basePrice) {
            assetsValue += inv.property.basePrice;
        } else if (inv.originalPrice) {
            assetsValue += inv.originalPrice;
        } else if (inv.item?.price) {
            assetsValue += inv.item.price * BigInt(inv.quantity);
        }
    }

    const totalNetWorth = walletBalance + bankBalance + assetsValue;
    return {
        walletBalance,
        bankBalance,
        assetsValue,
        totalNetWorth
    };
}

/**
 * Evaluates and recalculates a user's credit score based on their activities and asset holdings.
 * Clamped strictly between 0 and 1000.
 */
export async function evaluateCreditScore(userId: string): Promise<number> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return 0;

    let score = user.creditScore ?? 500;

    // Evaluate past 30 days activities
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentLogs = await prisma.activityLog.findMany({
        where: {
            userId,
            createdAt: { gte: thirtyDaysAgo }
        }
    });

    for (const log of recentLogs) {
        if (log.type === 'LOAN_REPAYMENT') score += 15;
        if (log.type === 'LOAN_DEFAULT') score -= 75;
        if (log.type === 'CASINO_LOSS' && (log.amount ?? BigInt(0)) > BigInt(10000000)) score -= 5;
        if (log.type === 'CASINO_WIN' && (log.amount ?? BigInt(0)) > BigInt(10000000)) score += 5;
        if (log.type === 'REAL_ESTATE_PURCHASE') score += 20;
    }

    // Evaluate total net worth bonus (financial stability)
    const { totalNetWorth } = await calculateUserNetWorth(userId);
    if (totalNetWorth > BigInt(100000000)) {
        score += 30;
    } else if (totalNetWorth > BigInt(25000000)) {
        score += 15;
    }

    const clampedScore = Math.max(0, Math.min(1000, score));

    // Update user credit score in DB if changed
    if (clampedScore !== user.creditScore) {
        await prisma.user.update({
            where: { id: userId },
            data: { creditScore: clampedScore }
        });
    }

    return clampedScore;
}

/**
 * Maps a credit score to a reputation category and maximum loan borrowing limit.
 */
export function getCreditTier(score: number): {
    reputation: 'Poor' | 'Fair' | 'Good' | 'Excellent';
    maxBorrowLimit: number;
    eligibleForLoan: boolean;
} {
    if (score >= 750) {
        return { reputation: 'Excellent', maxBorrowLimit: 100000000, eligibleForLoan: true }; // Up to Rp100.000.000
    }
    if (score >= 600) {
        return { reputation: 'Good', maxBorrowLimit: 50000000, eligibleForLoan: true }; // Up to Rp50.000.000
    }
    if (score >= 450) {
        return { reputation: 'Fair', maxBorrowLimit: 15000000, eligibleForLoan: true }; // Up to Rp15.000.000
    }
    return { reputation: 'Poor', maxBorrowLimit: 0, eligibleForLoan: false };
}

/**
 * Logs a significant financial activity for credit scoring.
 */
export async function logUserActivity(
    userId: string,
    type: string,
    amount?: number | bigint,
    description?: string
): Promise<void> {
    try {
        await prisma.activityLog.create({
            data: {
                userId,
                type,
                amount: amount !== undefined ? BigInt(amount) : null,
                description: description || null
            }
        });
    } catch (err) {
        console.error(`[LoanService] Failed to log user activity ${type} for ${userId}:`, err);
    }
}

/**
 * Fetches full credit profile for user.
 */
export async function getCreditProfile(userJid: string): Promise<CreditProfile | null> {
    const bankAccount = await getBankAccountByUser(userJid);
    if (!bankAccount) return null;

    const userId = bankAccount.user.id;
    const score = await evaluateCreditScore(userId);
    const { reputation, maxBorrowLimit } = getCreditTier(score);
    const netWorthData = await calculateUserNetWorth(userId);

    const activeLoan = await prisma.loan.findFirst({
        where: {
            userId,
            status: 'ACTIVE'
        }
    });

    const totalRepayments = await prisma.activityLog.count({
        where: { userId, type: 'LOAN_REPAYMENT' }
    });

    const totalDefaults = await prisma.activityLog.count({
        where: { userId, type: 'LOAN_DEFAULT' }
    });

    return {
        userId,
        creditScore: score,
        reputation,
        maxBorrowLimit,
        netWorth: netWorthData.totalNetWorth,
        walletBalance: netWorthData.walletBalance,
        bankBalance: netWorthData.bankBalance,
        assetsValue: netWorthData.assetsValue,
        activeLoan,
        totalRepayments,
        totalDefaults
    };
}

/**
 * Assesses a loan application using Groq LLM with deterministic tool calling.
 */
export async function assessLoanWithAI(
    requestedAmount: number,
    creditProfile: CreditProfile,
    collateralItemName?: string
): Promise<AiLoanAssessmentResult> {
    // 1. Hard business rule gates:
    if (creditProfile.creditScore < 450) {
        return {
            approved: false,
            interestRate: 0,
            termDays: 0,
            reasoning: 'Credit score is below the minimum threshold of 450.',
            maxApprovedAmount: 0
        };
    }

    if (requestedAmount > creditProfile.maxBorrowLimit) {
        return {
            approved: false,
            interestRate: 0,
            termDays: 0,
            reasoning: `Requested loan exceeds maximum borrowing limit of ${formatRupiah(creditProfile.maxBorrowLimit)}.`,
            maxApprovedAmount: creditProfile.maxBorrowLimit
        };
    }
    // 2. Query Laya AI decision engine for zero-knowledge underwriting advisory signal
    const netWorthBig = creditProfile.netWorth;
    const netWorthTier: 'low' | 'medium' | 'high' | 'ultra' =
        netWorthBig > BigInt(100_000_000)
            ? 'ultra'
            : netWorthBig > BigInt(25_000_000)
              ? 'high'
              : netWorthBig > BigInt(5_000_000)
                ? 'medium'
                : 'low';

    const layaSignal = await DecisionClient.evaluateLoan({
        creditScore: creditProfile.creditScore,
        reputation: creditProfile.reputation,
        netWorthTier,
        requestedAmount,
        pastRepaymentsCount: creditProfile.totalRepayments,
        pastDefaultsCount: creditProfile.totalDefaults,
        hasCollateral: Boolean(collateralItemName)
    }).catch(() => null);

    if (layaSignal) {
        // Code-enforced bound checks: rates 2%-15%, tenors 7-30 days
        let interestRate = layaSignal.suggestedInterestRate;
        let termDays = layaSignal.suggestedTermDays;

        if (isNaN(interestRate) || interestRate < 0.02) interestRate = 0.05;
        if (interestRate > 0.15) interestRate = 0.15;
        if (isNaN(termDays) || termDays < 7) termDays = 7;
        if (termDays > 30) termDays = 30;

        const approved = layaSignal.recommendation === 'approved';
        return {
            approved,
            interestRate,
            termDays,
            reasoning: approved
                ? `Approved by Cosmos AI Underwriting based on ${creditProfile.reputation} credit reputation (${layaSignal.riskTier} risk tier).`
                : `Rejected by Cosmos AI Underwriting due to elevated risk profile (${layaSignal.riskTier} risk tier).`,
            maxApprovedAmount: creditProfile.maxBorrowLimit
        };
    }

    // 3. Fallback to Groq LLM if Laya is unavailable
    if (process.env.GROQ_API_KEY) {
        try {
            const groq = getGroqClient();
            const systemPrompt = `You are a strict and professional credit risk underwriting officer for Cosmos Central Bank.
Assess the loan application based on the user's financial profile.
Use the Native Function Calling API. Strictly do NOT output raw XML tags such as <function=...> manually in your response text!
All output strings must be in formal English.

Scoring benchmarks:
- Excellent (750-1000): Lowest interest rate (2% - 5%), longer terms (21 - 30 days).
- Good (600-749): Moderate interest rate (5% - 8%), standard terms (14 - 21 days).
- Fair (450-599): Higher interest rate (8% - 12%), shorter terms (7 - 14 days). Viable collateral increases approval certainty.
If approved, interest_rate must be a float between 0.02 and 0.12 (e.g. 0.05 for 5%), and term_days an integer between 7 and 30.`;

            const userPrompt = `Loan Application Details:
- Requested Amount: ${formatRupiah(requestedAmount)}
- Credit Score: ${creditProfile.creditScore}/1000 (${creditProfile.reputation})
- Total Net Worth: ${formatRupiah(creditProfile.netWorth)}
- Bank Balance: ${formatRupiah(creditProfile.bankBalance)}
- Wallet Cash: ${formatRupiah(creditProfile.walletBalance)}
- Assets Value: ${formatRupiah(creditProfile.assetsValue)}
- Pledged Collateral: ${collateralItemName || 'None'}
- Past Repayments: ${creditProfile.totalRepayments}
- Past Defaults: ${creditProfile.totalDefaults}

Determine whether to approve or reject this loan and establish interest rate and repayment timeframe.`;

            const completion = await groq.chat.completions.create({
                model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1,
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'evaluate_loan_application',
                            description: 'Deliver the official credit assessment decision for the loan.',
                            parameters: {
                                type: 'object',
                                properties: {
                                    approved: {
                                        type: 'boolean',
                                        description: 'True if the loan is approved, false otherwise.'
                                    },
                                    interest_rate: {
                                        type: 'number',
                                        description: 'Annualized or term interest rate (e.g. 0.05 for 5%).'
                                    },
                                    term_days: {
                                        type: 'integer',
                                        description: 'Repayment period in days (e.g. 14, 21, 30).'
                                    },
                                    reasoning: {
                                        type: 'string',
                                        description:
                                            'A concise formal English explanation of the underwriting decision.'
                                    }
                                },
                                required: ['approved', 'interest_rate', 'term_days', 'reasoning']
                            }
                        }
                    }
                ],
                tool_choice: { type: 'function', function: { name: 'evaluate_loan_application' } }
            });

            const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
            if (toolCall && toolCall.function.name === 'evaluate_loan_application') {
                const parsed = JSON.parse(toolCall.function.arguments);
                let interestRate = Number(parsed.interest_rate);
                let termDays = parseInt(parsed.term_days, 10);

                // Sanitize & enforce bounds
                if (isNaN(interestRate) || interestRate < 0.02) interestRate = 0.05;
                if (interestRate > 0.15) interestRate = 0.15;
                if (isNaN(termDays) || termDays < 7) termDays = 7;
                if (termDays > 30) termDays = 30;

                return {
                    approved: Boolean(parsed.approved),
                    interestRate,
                    termDays,
                    reasoning: parsed.reasoning || 'Underwriting assessment complete.',
                    maxApprovedAmount: creditProfile.maxBorrowLimit
                };
            }
        } catch (err) {
            console.error('[LoanService] Groq AI assessment failed, falling back to deterministic underwriting:', err);
        }
    }

    // Fallback deterministic underwriting if AI service is temporarily unreachable
    const rate = creditProfile.creditScore >= 750 ? 0.04 : creditProfile.creditScore >= 600 ? 0.06 : 0.09;
    const term = creditProfile.creditScore >= 750 ? 30 : creditProfile.creditScore >= 600 ? 21 : 14;

    return {
        approved: true,
        interestRate: rate,
        termDays: term,
        reasoning: `Approved based on your ${creditProfile.reputation} credit reputation (${creditProfile.creditScore}/1000).`,
        maxApprovedAmount: creditProfile.maxBorrowLimit
    };
}

const activeDisbursements = new Set<string>();
const activeRepayments = new Set<string>();

/**
 * Atomically disburses an approved loan into the user's BankAccount.
 * Protected against race conditions via in-flight memory locks and serializable checks inside prisma.$transaction.
 */
export async function disburseLoan(
    userId: string,
    principalAmount: number,
    interestRate: number,
    termDays: number,
    collateralItemName?: string
): Promise<{
    success: boolean;
    loan?: any;
    error?: string;
    newBankBalance?: bigint;
    dueDate?: Date;
}> {
    if (activeDisbursements.has(userId)) {
        return { success: false, error: 'A loan disbursement is already being processed for this user.' };
    }
    activeDisbursements.add(userId);

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { bankAccount: true }
        });

        if (!user || !user.bankAccount) {
            return { success: false, error: 'User does not possess an active bank account.' };
        }

        if (user.bankAccount.status !== 'ACTIVE') {
            return { success: false, error: `Bank account is currently ${user.bankAccount.status}.` };
        }

        const dueDate = new Date(Date.now() + termDays * 24 * 60 * 60 * 1000);
        const remindAt = new Date(dueDate.getTime() - 5 * 24 * 60 * 60 * 1000);

        const result = await prisma.$transaction(async (tx) => {
            // Strict ACID check inside transaction to prevent duplicate active loans
            const existingActiveLoan = await tx.loan.findFirst({
                where: { userId, status: 'ACTIVE' }
            });
            if (existingActiveLoan) {
                throw new Error('User already has an active loan in progress.');
            }

            const currentAccount = await tx.bankAccount.findUnique({
                where: { accountNumber: user.bankAccount!.accountNumber }
            });
            if (!currentAccount || currentAccount.status !== 'ACTIVE') {
                throw new Error(`Bank account is currently ${currentAccount?.status || 'UNAVAILABLE'}.`);
            }

            // 1. Create the Loan record
            const loan = await tx.loan.create({
                data: {
                    userId,
                    principalAmount: BigInt(principalAmount),
                    interestRate,
                    dueDate,
                    status: 'ACTIVE',
                    collateralItems: collateralItemName ? JSON.stringify([collateralItemName]) : null
                }
            });

            // 2. Deposit funds into BankAccount
            const updatedAccount = await tx.bankAccount.update({
                where: { accountNumber: user.bankAccount!.accountNumber },
                data: { balance: { increment: BigInt(principalAmount) } }
            });

            // 3. Log BankTransaction
            await tx.bankTransaction.create({
                data: {
                    accountNumber: user.bankAccount!.accountNumber,
                    type: 'DEPOSIT',
                    amount: BigInt(principalAmount),
                    description: `Loan disbursement (${formatRupiah(principalAmount)}) - Due ${dueDate.toISOString().split('T')[0]}`
                }
            });

            // 4. Schedule 5-day reminder
            if (remindAt.getTime() > Date.now()) {
                await tx.loanReminder.create({
                    data: {
                        loanId: loan.id,
                        userJid: user.id,
                        remindAt,
                        sent: false
                    }
                });
            }

            // 5. Activity log
            await tx.activityLog.create({
                data: {
                    userId,
                    type: 'LOAN_DISBURSEMENT',
                    amount: BigInt(principalAmount),
                    description: `Approved loan with ${(interestRate * 100).toFixed(1)}% interest.`
                }
            });

            return { loan, updatedAccount };
        });

        return {
            success: true,
            loan: result.loan,
            newBankBalance: result.updatedAccount.balance,
            dueDate
        };
    } catch (err: any) {
        console.error('[LoanService] Failed to disburse loan:', err);
        return { success: false, error: err.message };
    } finally {
        activeDisbursements.delete(userId);
    }
}

/**
 * Calculates the exact repayment obligation for an active loan.
 */
export function calculateLoanPayable(loan: { principalAmount: bigint; interestRate: number }): {
    principal: number;
    interestAmount: number;
    totalDue: number;
} {
    const principal = Number(loan.principalAmount);
    const interestAmount = Math.round(principal * loan.interestRate);
    const totalDue = principal + interestAmount;
    return { principal, interestAmount, totalDue };
}

/**
 * Repays an active loan either in part or in full from the user's BankAccount balance.
 * Protected against race conditions via in-flight memory locks and atomic balances inside transaction.
 */
export async function repayLoan(
    userId: string,
    repaymentAmount?: number
): Promise<{
    success: boolean;
    error?: string;
    paidAmount?: number;
    outstandingBalance?: number;
    isFullyPaid?: boolean;
    currentBankBalance?: bigint;
}> {
    if (activeRepayments.has(userId)) {
        return { success: false, error: 'A loan repayment is already being processed for this user.' };
    }
    activeRepayments.add(userId);

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { bankAccount: true }
        });

        if (!user || !user.bankAccount) {
            return { success: false, error: 'User does not possess an active bank account.' };
        }

        const updated = await prisma.$transaction(async (tx) => {
            const activeLoan = await tx.loan.findFirst({
                where: { userId, status: 'ACTIVE' }
            });

            if (!activeLoan) {
                throw new Error('NO_ACTIVE_LOAN');
            }

            const currentAccount = await tx.bankAccount.findUnique({
                where: { accountNumber: user.bankAccount!.accountNumber }
            });

            if (!currentAccount) {
                throw new Error('ACCOUNT_NOT_FOUND');
            }

            const { totalDue } = calculateLoanPayable(activeLoan);
            const amountToPay = repaymentAmount && repaymentAmount > 0 ? Math.min(repaymentAmount, totalDue) : totalDue;

            if (Number(currentAccount.balance) < amountToPay) {
                const err: any = new Error('INSUFFICIENT_FUNDS');
                err.totalDue = totalDue;
                err.currentBalance = currentAccount.balance;
                throw err;
            }

            // Deduct from bank account
            const updatedAccount = await tx.bankAccount.update({
                where: { accountNumber: user.bankAccount!.accountNumber },
                data: { balance: { decrement: BigInt(amountToPay) } }
            });

            await tx.bankTransaction.create({
                data: {
                    accountNumber: user.bankAccount!.accountNumber,
                    type: 'WITHDRAWAL',
                    amount: BigInt(amountToPay),
                    description: `Loan repayment towards loan ${activeLoan.id}`
                }
            });

            const remainingPrincipal = totalDue - amountToPay;
            const isFullyPaid = remainingPrincipal <= 0;

            if (isFullyPaid) {
                await tx.loan.update({
                    where: { id: activeLoan.id },
                    data: { status: 'PAID' }
                });

                // Boost credit score & log positive activity
                await tx.activityLog.create({
                    data: {
                        userId,
                        type: 'LOAN_REPAYMENT',
                        amount: BigInt(amountToPay),
                        description: 'Timely and full loan repayment.'
                    }
                });

                // Unblock bank account if frozen due to overdue loan
                if (currentAccount.status === 'FROZEN') {
                    await tx.bankAccount.update({
                        where: { accountNumber: user.bankAccount!.accountNumber },
                        data: { status: 'ACTIVE' }
                    });
                }
            } else {
                // Partial repayment: reduce principal
                await tx.loan.update({
                    where: { id: activeLoan.id },
                    data: { principalAmount: BigInt(remainingPrincipal), interestRate: 0 }
                });

                await tx.activityLog.create({
                    data: {
                        userId,
                        type: 'LOAN_PARTIAL_REPAYMENT',
                        amount: BigInt(amountToPay),
                        description: `Partial loan repayment. Remaining: ${formatRupiah(remainingPrincipal)}`
                    }
                });
            }

            return {
                updatedAccount,
                isFullyPaid,
                remainingPrincipal,
                amountToPay
            };
        });

        // Re-evaluate credit score in background
        evaluateCreditScore(userId).catch(() => {});

        return {
            success: true,
            paidAmount: updated.amountToPay,
            outstandingBalance: updated.remainingPrincipal,
            isFullyPaid: updated.isFullyPaid,
            currentBankBalance: updated.updatedAccount.balance
        };
    } catch (err: any) {
        if (err.message === 'NO_ACTIVE_LOAN') {
            return { success: false, error: 'No active loan found.' };
        }
        if (err.message === 'INSUFFICIENT_FUNDS') {
            return {
                success: false,
                error: 'INSUFFICIENT_FUNDS',
                outstandingBalance: err.totalDue,
                currentBankBalance: err.currentBalance
            };
        }
        console.error('[LoanService] Repayment failed:', err);
        return { success: false, error: err.message };
    } finally {
        activeRepayments.delete(userId);
    }
}

/**
 * Seizes inventory items from a user to settle a defaulted debt.
 * Implements the selective asset liquidation strategy.
 */
export async function seizeUserAssetsForDebt(
    userId: string,
    debtAmount: number
): Promise<{
    seizedItems: Array<{ name: string; value: number }>;
    totalRecovered: number;
    debtRemaining: number;
}> {
    const inventories = await prisma.userInventory.findMany({
        where: {
            userId,
            ownershipStatus: 'Owned'
        },
        include: {
            item: true,
            property: true
        },
        orderBy: [{ purchaseDate: 'asc' }]
    });

    const seizedItems: Array<{ name: string; value: number }> = [];
    let debtRemaining = debtAmount;
    let totalRecovered = 0;

    // Rank items by value (higher value assets first)
    const evaluatedAssets = inventories
        .map((inv) => {
            let assetValue = 0;
            const assetName = inv.name || inv.item?.name || inv.property?.name || 'Asset';

            if (inv.property?.basePrice) {
                assetValue = Number(inv.property.basePrice);
            } else if (inv.originalPrice) {
                assetValue = Number(inv.originalPrice);
            } else if (inv.item?.price) {
                assetValue = Number(inv.item.price) * inv.quantity;
            }

            return {
                inventoryId: inv.id,
                name: assetName,
                value: assetValue
            };
        })
        .filter((a) => a.value > 0)
        .sort((a, b) => b.value - a.value);

    for (const asset of evaluatedAssets) {
        if (debtRemaining <= 0) break;

        // Seize this asset
        await prisma.userInventory.update({
            where: { id: asset.inventoryId },
            data: { ownershipStatus: 'Pawned' }
        });

        seizedItems.push({ name: asset.name, value: asset.value });
        totalRecovered += asset.value;
        debtRemaining = Math.max(0, debtRemaining - asset.value);
    }

    return {
        seizedItems,
        totalRecovered,
        debtRemaining
    };
}

/**
 * Background worker task that checks for overdue loans, executes bank freezes, and seizes assets.
 */
export async function processOverdueLoans(sock?: any): Promise<{
    processedCount: number;
    seizedCount: number;
}> {
    const now = new Date();

    const overdueLoans = await prisma.loan.findMany({
        where: {
            status: 'ACTIVE',
            dueDate: { lte: now }
        },
        include: {
            user: {
                include: { bankAccount: true }
            }
        }
    });

    let processedCount = 0;
    let seizedCount = 0;

    for (const loan of overdueLoans) {
        processedCount++;
        const userId = loan.userId;
        const { totalDue } = calculateLoanPayable(loan);

        // 1. Temporarily freeze the bank account
        if (loan.user.bankAccount && loan.user.bankAccount.status === 'ACTIVE') {
            await prisma.bankAccount.update({
                where: { accountNumber: loan.user.bankAccount.accountNumber },
                data: { status: 'FROZEN' }
            });

            // Log activity and penalize credit score
            await prisma.activityLog.create({
                data: {
                    userId,
                    type: 'LOAN_DEFAULT',
                    amount: BigInt(totalDue),
                    description: `Missed loan deadline of ${formatRupiah(totalDue)}. Account frozen.`
                }
            });

            await evaluateCreditScore(userId);

            // Send notification if socket available
            if (sock) {
                const lang = await getChatLanguage(loan.user.id);
                const t = getTranslator(lang);
                const notice = t('tools.loan.overdue_blocked', { amount: formatRupiah(totalDue) });
                sock.sendMessage(loan.user.id, { text: notice }).catch(() => {});
            }
        }

        // 2. Seize assets to clear the debt
        const seizure = await seizeUserAssetsForDebt(userId, totalDue);

        if (seizure.seizedItems.length > 0) {
            seizedCount++;

            // Check if debt is fully cleared or mostly satisfied
            if (seizure.debtRemaining <= 0) {
                await prisma.loan.update({
                    where: { id: loan.id },
                    data: { status: 'DEFAULTED' }
                });

                // Lift restriction
                if (loan.user.bankAccount) {
                    await prisma.bankAccount.update({
                        where: { accountNumber: loan.user.bankAccount.accountNumber },
                        data: { status: 'ACTIVE' }
                    });
                }
            }

            // Send seizure notification
            if (sock) {
                const lang = await getChatLanguage(loan.user.id);
                const t = getTranslator(lang);
                const assetsList = seizure.seizedItems
                    .map((item) => `1x ${item.name} (${formatRupiah(item.value)})`)
                    .join(', ');
                const seizureNotice = t('tools.loan.seizure_notification', {
                    amount: formatRupiah(totalDue),
                    assetsList
                });
                sock.sendMessage(loan.user.id, { text: seizureNotice }).catch(() => {});
            }
        }
    }

    return { processedCount, seizedCount };
}

/**
 * Background worker to send 5-day reminders for pending loan due dates.
 */
export async function processLoanReminders(sock?: any): Promise<number> {
    const now = new Date();

    const pendingReminders = await prisma.loanReminder.findMany({
        where: {
            sent: false,
            remindAt: { lte: now }
        },
        include: {
            loan: true
        }
    });

    let sentCount = 0;
    for (const reminder of pendingReminders) {
        if (reminder.loan.status === 'ACTIVE') {
            if (sock) {
                const target = reminder.chatJid || reminder.userJid;
                const lang = await getChatLanguage(target);
                const t = getTranslator(lang);
                const reminderMsg = t('tools.loan.reminder_5_days');
                sock.sendMessage(target, { text: reminderMsg }).catch(() => {});
            }
        }

        await prisma.loanReminder.update({
            where: { id: reminder.id },
            data: { sent: true }
        });
        sentCount++;
    }

    return sentCount;
}

/**
 * Starts the scheduled background cron job to check loan reminders and overdue loans every hour.
 */
export function startLoanSchedulerCron(getSock?: () => any): void {
    // Run every hour
    cron.schedule(
        '0 * * * *',
        async () => {
            const sock = getSock ? getSock() : undefined;
            try {
                await processLoanReminders(sock);
                await processOverdueLoans(sock);
            } catch (err) {
                console.error('[LoanService] Error executing loan background cron:', err);
            }
        },
        { timezone: 'Asia/Jakarta' }
    );
    console.log('[LoanService] Loan monitoring & reminder cron scheduled to run hourly.');
}
