import { ToolDefinition, ToolContext, ToolModule } from './types.js';
import { getSenderJid, cleanId } from '#utils/casino.js';
import { formatRupiah, parseCurrencyAmount } from '#utils/currency.js';
import { requireIdCard } from '#utils/idCard.js';
import { getBankAccountByUser } from '#services/bankService.js';
import {
    getCreditProfile,
    assessLoanWithAI,
    disburseLoan,
    repayLoan,
    calculateLoanPayable
} from '#services/loanService.js';
import { registerCancellableSession, unregisterCancellableSessionByUser } from '#utils/cancellationManager.js';
import { getTranslator } from '#utils/i18n.js';
import { prisma } from '#db.js';
import { renderCard, renderProgressBar, renderAlert, renderBadge, type TranslatorFn } from '#utils/uiFormatter.js';

export interface PendingLoanApplication {
    userId: string;
    chatJid: string;
    amount: number;
    interestRate: number;
    interestAmount: number;
    totalAmount: number;
    termDays: number;
    collateralItemName?: string;
    reasoning: string;
    createdAt: number;
}

const pendingLoans = new Map<string, PendingLoanApplication>();
const activeAssessments = new Set<string>();
const LOAN_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes confirmation timeout

export function getPendingLoan(userJid: string, remoteJid?: string): PendingLoanApplication | undefined {
    const cleaned = cleanId(userJid);
    const pending = pendingLoans.get(cleaned);
    if (!pending) return undefined;
    if (Date.now() - pending.createdAt > LOAN_TIMEOUT_MS) {
        pendingLoans.delete(cleaned);
        return undefined;
    }
    if (remoteJid && cleanId(pending.chatJid) !== cleanId(remoteJid)) {
        return undefined;
    }
    return pending;
}

export function clearPendingLoan(userJid: string, remoteJid?: string): boolean {
    const cleaned = cleanId(userJid);
    const pending = pendingLoans.get(cleaned);
    if (!pending) return false;
    if (remoteJid && cleanId(pending.chatJid) !== cleanId(remoteJid)) {
        return false;
    }
    const chatJid = remoteJid || pending.chatJid;
    if (chatJid) {
        unregisterCancellableSessionByUser(cleaned, chatJid);
    }
    return pendingLoans.delete(cleaned);
}

/**
 * Intercepts incoming messages to process 'confirm' for pending loan disbursements.
 * Returns true if handled.
 */
export async function processLoanConfirmation(
    sock: any,
    msg: any,
    senderRaw: string,
    chatJid: string,
    text: string,
    t: TranslatorFn
): Promise<boolean> {
    const lower = text.trim().toLowerCase();
    if (lower !== 'confirm' && lower !== 'konfirmasi' && lower !== 'yes' && lower !== 'ya') {
        return false;
    }

    const pending = getPendingLoan(senderRaw, chatJid);
    if (!pending) {
        return false;
    }

    // Clear session & cancellation registration
    clearPendingLoan(senderRaw, chatJid);

    // Disburse the loan atomically
    const result = await disburseLoan(
        pending.userId,
        pending.amount,
        pending.interestRate,
        pending.termDays,
        pending.collateralItemName
    );

    if (!result.success || !result.dueDate) {
        await sock.sendMessage(chatJid, { text: result.error || t('tools.loan.disbursement_failed') }, { quoted: msg });
        return true;
    }

    const formattedDueDate = result.dueDate.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });

    const successMsg = t('tools.loan.approved', {
        amount: formatRupiah(pending.amount),
        dueDate: formattedDueDate
    });

    const card = renderAlert({
        type: 'success',
        title: t('tools.loan.title_disbursed'),
        message: successMsg,
        t,
        details: [
            t('tools.loan.detail_approved_amount', { amount: formatRupiah(pending.amount) }),
            t('tools.loan.detail_repayment_due', { dueDate: formattedDueDate })
        ]
    });

    await sock.sendMessage(chatJid, { text: card }, { quoted: msg });
    return true;
}

export const definition: ToolDefinition = {
    name: 'loan',
    title: 'Cosmos Central Bank Loan Facility',
    category: 'Banking',
    aliases: ['pinjam', 'pinjaman', 'hutang'],
    description: 'Apply for an AI-underwritten loan, repay active loans, or inspect credit score.',
    descriptionKey: 'tools.commands.loan.description',
    parameters: {
        type: 'object',
        properties: {
            subcommand: {
                type: 'string',
                description: 'The loan subcommand: apply, pay, status, info'
            },
            amount: {
                type: 'string',
                description: 'The loan or repayment amount (e.g. 25000000 or 25jt).'
            },
            collateral: {
                type: 'string',
                description: 'Optional name of an owned property or asset to pledge as collateral.'
            }
        }
    }
};

export async function execute(args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const t = ctx?.t || getTranslator('en');
    const senderJid = getSenderJid(ctx.msg, ctx.sock);
    if (!senderJid) {
        return t('core.sender_identity_error');
    }

    // Step 1: Verification Hook (IdCard Requirement)
    const auth = await requireIdCard(senderJid, t);
    if (!auth.authorized || !auth.idCard) {
        return auth.message || t('tools.loan.no_id_card');
    }

    // Step 2: Verification Hook (BankAccount Requirement)
    const bankAccount = await getBankAccountByUser(senderJid);

    const rawText = (ctx.msg.message?.conversation || ctx.msg.message?.extendedTextMessage?.text || '').trim();
    const parts = rawText.split(/\s+/);
    // Format: .loan <subcommand> [amount] [collateral...]
    const subCommand = (parts[1] || args.subcommand || '').toLowerCase();
    const remainingParts = parts.slice(2);

    // Backwards compatibility for direct verification tests or callers executing .loan <amount>
    // If no subcommand is specified (or subcommand is a number), and bankAccount does not exist,
    // return legacy approval response if auth is valid.
    if (
        !subCommand ||
        /^\d+/.test(subCommand) ||
        (![
            'apply',
            'ajukan',
            'request',
            'pay',
            'repay',
            'bayar',
            'lunasi',
            'status',
            'active',
            'cek',
            'info',
            'credit',
            'score',
            'limit'
        ].includes(subCommand) &&
            (args.amount || /^\d+/.test(parts[1] || '')))
    ) {
        if (!bankAccount) {
            const rawAmt = args.amount || parts[1] || '';
            const parsedAmt = parseCurrencyAmount(rawAmt);
            if (parsedAmt && parsedAmt > 0) {
                return t('tools.loan.legacy_approved', {
                    amount: formatRupiah(parsedAmt),
                    nik: auth.idCard.nik
                });
            }
            return t('tools.loan.no_bank_account');
        }
    }

    if (!bankAccount) {
        return t('tools.loan.no_bank_account');
    }

    const userId = bankAccount.user.id;

    switch (subCommand) {
        case 'apply':
        case 'ajukan':
        case 'request': {
            if (bankAccount.status !== 'ACTIVE') {
                return t('tools.loan.bank_account_frozen', { status: bankAccount.status });
            }

            const amountInput = remainingParts[0] || args.amount || '';
            const loanAmount = parseCurrencyAmount(amountInput);

            if (!loanAmount || loanAmount <= 0) {
                return t('tools.loan.invalid_amount');
            }

            // Check if user already has an active loan
            const existingLoan = await prisma.loan.findFirst({
                where: { userId, status: 'ACTIVE' }
            });
            if (existingLoan) {
                const { totalDue } = calculateLoanPayable(existingLoan);
                const dueDateStr = new Date(existingLoan.dueDate).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                });
                return t('tools.loan.active_loan_exists', {
                    balance: formatRupiah(totalDue),
                    dueDate: dueDateStr
                });
            }

            // Check if user already has an active pending confirmation
            const cleanedSender = cleanId(senderJid);
            if (getPendingLoan(cleanedSender, ctx.jid)) {
                return t('tools.loan.pending_session_exists');
            }

            if (activeAssessments.has(cleanedSender)) {
                return t('tools.loan.assessment_in_progress');
            }
            activeAssessments.add(cleanedSender);

            try {
                // Fetch credit profile
                const creditProfile = await getCreditProfile(senderJid);
                if (!creditProfile) {
                    return t('tools.loan.rejected');
                }

                if (creditProfile.creditScore < 450) {
                    return t('tools.loan.credit_score_too_low', {
                        score: creditProfile.creditScore,
                        minScore: 450
                    });
                }

                if (loanAmount > creditProfile.maxBorrowLimit) {
                    return t('tools.loan.amount_exceeds_limit', {
                        amount: formatRupiah(loanAmount),
                        limit: formatRupiah(creditProfile.maxBorrowLimit),
                        score: creditProfile.creditScore
                    });
                }

                // Optional collateral check
                let collateralName: string | undefined = undefined;
                if (remainingParts.length > 1 || args.collateral) {
                    const candidateCollateral = (remainingParts.slice(1).join(' ') || args.collateral || '').trim();
                    if (candidateCollateral) {
                        const ownedAsset = await prisma.userInventory.findFirst({
                            where: {
                                userId,
                                ownershipStatus: 'Owned',
                                OR: [
                                    { name: { contains: candidateCollateral } },
                                    { item: { name: { contains: candidateCollateral } } },
                                    { property: { name: { contains: candidateCollateral } } }
                                ]
                            },
                            include: { item: true, property: true }
                        });

                        if (!ownedAsset) {
                            return t('tools.loan.collateral_not_found', { item: candidateCollateral });
                        }
                        collateralName =
                            ownedAsset.name ||
                            ownedAsset.property?.name ||
                            ownedAsset.item?.name ||
                            candidateCollateral;
                    }
                }

                // AI Underwriting Assessment
                const assessment = await assessLoanWithAI(loanAmount, creditProfile, collateralName);

                if (!assessment.approved) {
                    return t('tools.loan.rejected');
                }

                const interestAmount = Math.round(loanAmount * assessment.interestRate);
                const totalRepayment = loanAmount + interestAmount;
                const dueDate = new Date(Date.now() + assessment.termDays * 24 * 60 * 60 * 1000);
                const formattedDueDate = dueDate.toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                });

                // Save pending loan application
                const pending: PendingLoanApplication = {
                    userId,
                    chatJid: ctx.jid,
                    amount: loanAmount,
                    interestRate: assessment.interestRate,
                    interestAmount,
                    totalAmount: totalRepayment,
                    termDays: assessment.termDays,
                    collateralItemName: collateralName,
                    reasoning: assessment.reasoning,
                    createdAt: Date.now()
                };
                pendingLoans.set(cleanedSender, pending);

                // Register with global cancellation system (.cancel)
                registerCancellableSession({
                    sessionId: `loan_app_${cleanedSender}`,
                    feature: 'loan',
                    userJid: cleanedSender,
                    chatJid: ctx.jid,
                    description: 'loan application',
                    onCancel: async () => {
                        pendingLoans.delete(cleanedSender);
                        return t('tools.loan.cancelled');
                    }
                });

                const promptCard = renderCard({
                    title: t('tools.loan.card_title_underwriting'),
                    icon: '🏛️',
                    headerStyle: 'heavy',
                    t,
                    subtitle: t('tools.loan.subtitle_underwriting'),
                    fields: [
                        { icon: '👤', label: t('tools.loan.label_applicant'), value: auth.idCard?.fullName || userId },
                        {
                            icon: '📊',
                            label: t('tools.loan.label_credit_score'),
                            value: `${creditProfile.creditScore} / 1000 (${creditProfile.reputation})\n    ${renderProgressBar({ current: creditProfile.creditScore, max: 1000 })}`
                        },
                        { icon: '💵', label: t('tools.loan.label_approved_loan'), value: formatRupiah(loanAmount) },
                        {
                            icon: '📈',
                            label: t('tools.loan.label_interest_rate'),
                            value: t('tools.loan.accrued_format', {
                                rate: (assessment.interestRate * 100).toFixed(1),
                                accrued: formatRupiah(interestAmount)
                            })
                        },
                        {
                            icon: '💰',
                            label: t('tools.loan.label_total_repayment'),
                            value: formatRupiah(totalRepayment)
                        },
                        {
                            icon: '📅',
                            label: t('tools.loan.label_term_tenor'),
                            value: t('tools.loan.tenor_format', {
                                days: assessment.termDays,
                                dueDate: formattedDueDate
                            })
                        },
                        {
                            icon: '📦',
                            label: t('tools.loan.label_pledged_collateral'),
                            value: collateralName || t('tools.loan.value_none')
                        },
                        { icon: '🧠', label: t('tools.loan.label_ai_note'), value: `"${assessment.reasoning}"` }
                    ]
                });

                return [promptCard, '', t('tools.loan.instruction_confirm'), t('tools.loan.instruction_cancel')].join(
                    '\n'
                );
            } finally {
                activeAssessments.delete(cleanedSender);
            }
        }

        case 'pay':
        case 'repay':
        case 'bayar':
        case 'lunasi': {
            const activeLoan = await prisma.loan.findFirst({
                where: { userId, status: 'ACTIVE' }
            });
            if (!activeLoan) {
                return t('tools.loan.no_active_loan');
            }

            const { totalDue } = calculateLoanPayable(activeLoan);
            const amountInput = remainingParts[0] || args.amount || '';
            const parsedPayment = amountInput ? parseCurrencyAmount(amountInput, bankAccount.balance) : totalDue;

            if (parsedPayment === null || parsedPayment <= 0) {
                return t('tools.loan.repay_invalid_amount');
            }

            const paymentToExecute = Math.min(parsedPayment, totalDue);

            if (Number(bankAccount.balance) < paymentToExecute) {
                return t('tools.loan.repay_insufficient_funds', {
                    bankBalance: formatRupiah(bankAccount.balance),
                    requiredAmount: formatRupiah(paymentToExecute)
                });
            }

            const result = await repayLoan(userId, paymentToExecute);
            if (!result.success) {
                if (result.error === 'INSUFFICIENT_FUNDS') {
                    return t('tools.loan.repay_insufficient_funds', {
                        bankBalance: formatRupiah(result.currentBankBalance ?? 0),
                        requiredAmount: formatRupiah(paymentToExecute)
                    });
                }
                return t('tools.loan.repay_failed');
            }

            return renderAlert({
                type: 'success',
                title: t('tools.loan.title_repaid'),
                message: t('tools.loan.repay_success', {
                    amount: formatRupiah(result.paidAmount ?? paymentToExecute),
                    outstandingBalance: formatRupiah(result.outstandingBalance ?? 0)
                }),
                t,
                details: [
                    t('tools.loan.detail_amount_paid', { amount: formatRupiah(result.paidAmount ?? paymentToExecute) }),
                    t('tools.loan.detail_outstanding_debt', { debt: formatRupiah(result.outstandingBalance ?? 0) })
                ]
            });
        }

        case 'status':
        case 'active':
        case 'cek': {
            const activeLoan = await prisma.loan.findFirst({
                where: { userId, status: 'ACTIVE' }
            });
            if (!activeLoan) {
                return t('tools.loan.no_active_loan');
            }

            const { principal, interestAmount, totalDue } = calculateLoanPayable(activeLoan);
            const dueDate = new Date(activeLoan.dueDate);
            const formattedDueDate = dueDate.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });

            const diffMs = dueDate.getTime() - Date.now();
            const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
            const timeRemaining =
                diffMs > 0 ? t('tools.loan.days_suffix', { days: daysRemaining }) : t('tools.loan.value_overdue');

            let collateral = t('tools.loan.value_none');
            if (activeLoan.collateralItems) {
                try {
                    const parsed = JSON.parse(activeLoan.collateralItems);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        collateral = parsed.join(', ');
                    }
                } catch {
                    collateral = activeLoan.collateralItems;
                }
            }

            return renderCard({
                title: t('tools.loan.card_title_active_status'),
                icon: '📋',
                headerStyle: 'heavy',
                t,
                fields: [
                    { icon: '💵', label: t('tools.loan.label_original_principal'), value: formatRupiah(principal) },
                    {
                        icon: '📈',
                        label: t('tools.loan.label_interest_rate'),
                        value: `${(activeLoan.interestRate * 100).toFixed(1)}% (${formatRupiah(interestAmount)})`
                    },
                    { icon: '💰', label: t('tools.loan.label_total_amount_due'), value: formatRupiah(totalDue) },
                    { icon: '📅', label: t('tools.loan.label_repayment_due_date'), value: formattedDueDate },
                    { icon: '⏱️', label: t('tools.loan.label_time_remaining'), value: timeRemaining },
                    { icon: '📦', label: t('tools.loan.label_pledged_collateral'), value: collateral },
                    { icon: '🏛️', label: t('tools.loan.label_loan_status'), value: renderBadge(activeLoan.status) }
                ],
                tips: [t('tools.loan.tip_repay')]
            });
        }

        case 'info':
        case 'credit':
        case 'score':
        case 'limit': {
            const creditProfile = await getCreditProfile(senderJid);
            if (!creditProfile) {
                return t('tools.loan.no_bank_account');
            }

            const activeLoanCount = creditProfile.activeLoan ? 1 : 0;

            return renderCard({
                title: t('tools.loan.card_title_credit_profile'),
                icon: '📊',
                headerStyle: 'heavy',
                t,
                fields: [
                    {
                        icon: '📊',
                        label: t('tools.loan.label_credit_score'),
                        value: `${creditProfile.creditScore}/1000 (${creditProfile.reputation})\n    ${renderProgressBar({ current: creditProfile.creditScore, max: 1000 })}`
                    },
                    {
                        icon: '💳',
                        label: t('tools.loan.label_max_loan_limit'),
                        value: formatRupiah(creditProfile.maxBorrowLimit)
                    },
                    {
                        icon: '💎',
                        label: t('tools.loan.label_estimated_net_worth'),
                        value: formatRupiah(creditProfile.netWorth)
                    },
                    {
                        icon: '💵',
                        label: t('tools.loan.label_wallet_cash'),
                        value: formatRupiah(creditProfile.walletBalance)
                    },
                    {
                        icon: '🏦',
                        label: t('tools.loan.label_bank_balance'),
                        value: formatRupiah(creditProfile.bankBalance)
                    },
                    {
                        icon: '📦',
                        label: t('tools.loan.label_assets_value'),
                        value: formatRupiah(creditProfile.assetsValue)
                    },
                    { icon: '📋', label: t('tools.loan.label_active_loans'), value: `${activeLoanCount}` },
                    {
                        icon: '📜',
                        label: t('tools.loan.label_repayments_defaults'),
                        value: `${creditProfile.totalRepayments} / ${creditProfile.totalDefaults}`
                    }
                ],
                tips: [t('tools.loan.tip_apply')]
            });
        }

        default: {
            return t('tools.loan.usage');
        }
    }
}

const loanTool: ToolModule = {
    definition,
    execute
};

export default loanTool;
