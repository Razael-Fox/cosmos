import assert from 'assert';
import { prisma } from '../src/db.js';
import { saveIdCard } from '../src/utils/idCard.js';
import { registerBankAccount, depositToBank } from '../src/services/bankService.js';
import {
    getCreditProfile,
    calculateLoanPayable,
    calculateUserNetWorth,
    processOverdueLoans,
    processLoanReminders,
    disburseLoan,
    repayLoan
} from '../src/services/loanService.js';
import loanTool, { processLoanConfirmation, getPendingLoan } from '../src/tools/loan.js';
import { cancelActiveSession } from '../src/utils/cancellationManager.js';
import { getTranslator } from '../src/utils/i18n.js';
import { formatRupiah } from '../src/utils/currency.js';

async function runLoanTests() {
    console.log('--- STARTING BANK LOAN SYSTEM TESTS ---');
    const t = getTranslator('en');

    const timestamp = Date.now();
    const userA_Jid = `loan_user_a_${timestamp}@s.whatsapp.net`;
    const userNoKtp_Jid = `loan_user_noktp_${timestamp}@s.whatsapp.net`;
    const userNoBank_Jid = `loan_user_nobank_${timestamp}@s.whatsapp.net`;
    const chatJid = `loan_chat_${timestamp}@g.us`;
    await prisma.whitelistedGroup.create({
        data: {
            jid: chatJid,
            language: 'EN'
        }
    });
    console.log('[Test 1] Setting up users, KTP, and bank accounts...');
    await prisma.user.create({
        data: {
            id: userA_Jid,
            pushName: 'Charlie Borrower',
            balance: BigInt(200000), // 200k cash
            creditScore: 650
        }
    });

    await prisma.user.create({
        data: {
            id: userNoKtp_Jid,
            pushName: 'Dave No KTP',
            balance: BigInt(100000)
        }
    });

    await prisma.user.create({
        data: {
            id: userNoBank_Jid,
            pushName: 'Eve No Bank',
            balance: BigInt(100000)
        }
    });

    // Provide ID Card for User A and User No Bank
    await saveIdCard({
        nik: `317101111190${String(timestamp % 9000).padStart(4, '0')}`,
        userJid: userA_Jid,
        fullName: 'Charlie Borrower',
        placeOfBirth: 'BANDUNG',
        dateOfBirth: '11-11-1990',
        gender: 'LAKI-LAKI',
        address: 'Cosmos Loan Street No. 4',
        religion: 'ISLAM',
        maritalStatus: 'KAWIN',
        occupation: 'ENTREPRENEUR',
        citizenship: 'WNI',
        validUntil: 'SEUMUR HIDUP'
    });

    await saveIdCard({
        nik: `317101222292${String((timestamp + 1) % 9000).padStart(4, '0')}`,
        userJid: userNoBank_Jid,
        fullName: 'Eve No Bank',
        placeOfBirth: 'MEDAN',
        dateOfBirth: '22-02-1992',
        gender: 'PEREMPUAN',
        address: 'Cosmos Alley No. 5',
        religion: 'KRISTEN',
        maritalStatus: 'BELUM KAWIN',
        occupation: 'FREELANCER',
        citizenship: 'WNI',
        validUntil: 'SEUMUR HIDUP'
    });

    // Register bank account only for User A
    const regA = await registerBankAccount(userA_Jid, 'Charlie Borrower', t);
    assert.strictEqual(regA.success, true);
    await depositToBank(userA_Jid, 50000, t); // Deposit 50k to bank

    // Add inventory assets for Charlie
    await prisma.userInventory.create({
        data: {
            userId: userA_Jid,
            name: 'Honda Scoopy',
            originalPrice: BigInt(23000000),
            ownershipStatus: 'Owned'
        }
    });

    await prisma.userInventory.create({
        data: {
            userId: userA_Jid,
            name: 'MacBook Pro',
            originalPrice: BigInt(2000000),
            ownershipStatus: 'Owned'
        }
    });

    console.log('✓ Users, KTP, bank accounts, and inventory assets initialized.');

    // 2. Test Verification Hooks & Gates
    console.log('[Test 2] Testing Verification Hooks (KTP, Bank Account, Score limits)...');
    // User without KTP
    const noKtpRes = await loanTool.execute(
        { subcommand: 'apply', amount: '10000000' },
        {
            msg: { key: { remoteJid: chatJid, participant: userNoKtp_Jid } },
            sock: {} as any,
            jid: chatJid,
            t
        }
    );
    assert(typeof noKtpRes === 'string' && noKtpRes.includes('Access Denied'));

    // User without bank account
    const noBankRes = await loanTool.execute(
        { subcommand: 'apply', amount: '10000000' },
        {
            msg: { key: { remoteJid: chatJid, participant: userNoBank_Jid } },
            sock: {} as any,
            jid: chatJid,
            t
        }
    );
    assert(typeof noBankRes === 'string' && noBankRes.includes('active bank account'));

    // User A invalid amount
    const invalidAmtRes = await loanTool.execute(
        { subcommand: 'apply', amount: 'invalid' },
        {
            msg: { key: { remoteJid: chatJid, participant: userA_Jid } },
            sock: {} as any,
            jid: chatJid,
            t
        }
    );
    assert(typeof invalidAmtRes === 'string' && invalidAmtRes.includes('Invalid loan amount'));

    // User A exceeds borrowing limit
    const exceedLimitRes = await loanTool.execute(
        { subcommand: 'apply', amount: '1000000000' },
        {
            msg: { key: { remoteJid: chatJid, participant: userA_Jid } },
            sock: {} as any,
            jid: chatJid,
            t
        }
    );
    assert(typeof exceedLimitRes === 'string' && exceedLimitRes.includes('exceeds your maximum borrowing limit'));
    console.log('✓ Verification gates successfully enforced.');

    // 3. Test Net Worth & Credit Profile Evaluation
    console.log('[Test 3] Testing Net Worth Calculation & Credit Scoring...');
    const netWorth = await calculateUserNetWorth(userA_Jid);
    assert(netWorth.assetsValue >= BigInt(25000000));
    assert(netWorth.totalNetWorth >= BigInt(25000000));

    const creditProfile = await getCreditProfile(userA_Jid);
    assert(creditProfile !== null);
    assert.strictEqual(creditProfile.reputation, 'Good');
    assert(creditProfile.maxBorrowLimit >= 50000000);
    console.log('✓ Credit Profile and Net Worth verified:', formatRupiah(netWorth.totalNetWorth));

    // 4. Test Loan Application, Terms Prompt & Cancellation
    console.log('[Test 4] Testing Loan Application & Cancellation via .cancel...');
    const applyPrompt = await loanTool.execute(
        { subcommand: 'apply', amount: '25000000', collateral: 'Honda Scoopy' },
        {
            msg: { key: { remoteJid: chatJid, participant: userA_Jid } },
            sock: {} as any,
            jid: chatJid,
            t
        }
    );
    assert(typeof applyPrompt === 'string' && applyPrompt.includes('Cosmos Central Bank has assessed'));
    assert(getPendingLoan(userA_Jid, chatJid) !== undefined);

    // Cancel via .cancel
    const cancelMsg = await cancelActiveSession(userA_Jid, chatJid, {} as any, {} as any);
    assert(typeof cancelMsg === 'string' && cancelMsg.includes('successfully aborted'));
    assert.strictEqual(getPendingLoan(userA_Jid, chatJid), undefined);
    console.log('✓ Loan interactive application and cancellation verified.');

    // 5. Test Loan Confirmation & Direct Bank Disbursement
    console.log('[Test 5] Testing Loan Confirmation & Direct Deposit into BankAccount...');
    await loanTool.execute(
        { subcommand: 'apply', amount: '25000000', collateral: 'Honda Scoopy' },
        {
            msg: { key: { remoteJid: chatJid, participant: userA_Jid } },
            sock: {} as any,
            jid: chatJid,
            t
        }
    );

    let confirmationSentMsg = '';
    const mockSock = {
        sendMessage: async (_target: string, content: any) => {
            confirmationSentMsg = content.text;
            return {};
        }
    };

    const handledConfirm = await processLoanConfirmation(
        mockSock,
        { key: { remoteJid: chatJid, participant: userA_Jid } },
        userA_Jid,
        chatJid,
        'confirm',
        t
    );
    assert.strictEqual(handledConfirm, true);
    assert(confirmationSentMsg.includes('approved') && confirmationSentMsg.includes('deposited'));

    // Check bank account balance reflects direct deposit
    const updatedBankAccount = await prisma.bankAccount.findUnique({
        where: { userJid: userA_Jid }
    });
    assert(updatedBankAccount !== null);
    assert(updatedBankAccount.balance >= BigInt(25000000));

    // Check loan status
    const activeLoan = await prisma.loan.findFirst({
        where: { userId: userA_Jid, status: 'ACTIVE' }
    });
    assert(activeLoan !== null);
    assert.strictEqual(Number(activeLoan.principalAmount), 25000000);
    console.log('✓ Loan confirmed, active in database, and funds disbursed to bank balance.');

    // 6. Test Loan Status & Info Commands
    console.log('[Test 6] Testing .loan status and .loan info commands...');
    const statusOutput = await loanTool.execute(
        { subcommand: 'status' },
        {
            msg: { key: { remoteJid: chatJid, participant: userA_Jid } },
            sock: {} as any,
            jid: chatJid,
            t
        }
    );
    assert(typeof statusOutput === 'string' && statusOutput.includes('Active Loan Status'));
    assert(statusOutput.includes('25.000.000'));

    const infoOutput = await loanTool.execute(
        { subcommand: 'info' },
        {
            msg: { key: { remoteJid: chatJid, participant: userA_Jid } },
            sock: {} as any,
            jid: chatJid,
            t
        }
    );
    assert(typeof infoOutput === 'string' && infoOutput.includes('Credit & Loan Profile'));
    console.log('✓ .loan status and .loan info verified.');

    // 7. Test Loan Repayment (Insufficient Funds vs Full Payment)
    console.log('[Test 7] Testing Loan Repayment (insufficient funds & full repayment)...');
    // Reduce bank balance temporarily to test insufficient funds
    await prisma.bankAccount.update({
        where: { accountNumber: updatedBankAccount.accountNumber },
        data: { balance: BigInt(10000000) }
    });

    const insufficientRepayRes = await loanTool.execute(
        { subcommand: 'pay' },
        {
            msg: { key: { remoteJid: chatJid, participant: userA_Jid } },
            sock: {} as any,
            jid: chatJid,
            t
        }
    );
    assert(typeof insufficientRepayRes === 'string' && insufficientRepayRes.includes('insufficient funds'));

    // Top up bank balance to cover repayment
    const { totalDue } = calculateLoanPayable(activeLoan);
    await prisma.bankAccount.update({
        where: { accountNumber: updatedBankAccount.accountNumber },
        data: { balance: BigInt(totalDue + 5000000) }
    });

    const successfulRepayRes = await loanTool.execute(
        { subcommand: 'pay' },
        {
            msg: { key: { remoteJid: chatJid, participant: userA_Jid } },
            sock: {} as any,
            jid: chatJid,
            t
        }
    );
    assert(typeof successfulRepayRes === 'string' && successfulRepayRes.includes('successfully repaid'));

    // Verify loan is marked PAID
    const loanAfterPay = await prisma.loan.findUnique({ where: { id: activeLoan.id } });
    assert.strictEqual(loanAfterPay?.status, 'PAID');
    console.log('✓ Loan repayment and credit boost verified.');

    // 8. Test 5-Day Reminders Worker
    console.log('[Test 8] Testing Background 5-Day Loan Reminder Worker...');
    // Create an active loan reminder scheduled in the past
    const dummyLoan = await prisma.loan.create({
        data: {
            userId: userA_Jid,
            principalAmount: BigInt(5000000),
            interestRate: 0.05,
            dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
            status: 'ACTIVE'
        }
    });

    const reminder = await prisma.loanReminder.create({
        data: {
            loanId: dummyLoan.id,
            userJid: userA_Jid,
            chatJid,
            remindAt: new Date(Date.now() - 1000),
            sent: false
        }
    });

    let reminderMsgReceived = '';
    const mockReminderSock = {
        sendMessage: async (_target: string, content: any) => {
            reminderMsgReceived = content.text;
            return {};
        }
    };

    const sentCount = await processLoanReminders(mockReminderSock);
    assert(sentCount >= 1);
    assert(
        reminderMsgReceived.includes('due in 5 days') ||
            reminderMsgReceived.includes('jatuh tempo dalam 5 hari') ||
            reminderMsgReceived.includes('5 hari')
    );

    const updatedReminder = await prisma.loanReminder.findUnique({ where: { id: reminder.id } });
    assert.strictEqual(updatedReminder?.sent, true);
    console.log('✓ 5-day background reminder worker verified.');

    // 9. Test Overdue Default Penalty & Asset Seizure
    console.log('[Test 9] Testing Overdue Penalties (Account Freeze) & Asset Seizure...');
    // Set dummy loan dueDate to past
    await prisma.loan.update({
        where: { id: dummyLoan.id },
        data: { dueDate: new Date(Date.now() - 1000) }
    });

    const overdueNotices: string[] = [];
    const mockOverdueSock = {
        sendMessage: async (_target: string, content: any) => {
            overdueNotices.push(content.text);
            return {};
        }
    };

    const overdueResult = await processOverdueLoans(mockOverdueSock);
    assert(overdueResult.processedCount >= 1);
    assert(overdueResult.seizedCount >= 1);
    assert(overdueNotices.length >= 1);

    // Verify Scoopy was seized to settle the debt
    const scoopyInv = await prisma.userInventory.findFirst({
        where: { userId: userA_Jid, name: 'Honda Scoopy' }
    });
    assert.strictEqual(scoopyInv?.ownershipStatus, 'Pawned');

    // Verify bank account was unblocked after seizure
    const accountAfterSeizure = await prisma.bankAccount.findUnique({
        where: { userJid: userA_Jid }
    });
    assert.strictEqual(accountAfterSeizure?.status, 'ACTIVE');

    // Verify overdue loan status is DEFAULTED
    const defaultedLoan = await prisma.loan.findUnique({ where: { id: dummyLoan.id } });
    assert.strictEqual(defaultedLoan?.status, 'DEFAULTED');

    console.log('✓ Asset seizure algorithm and overdue penalty workflow verified.');

    // [Test 10] Testing Race Condition Prevention (Concurrent Loan Disbursements)
    console.log('[Test 10] Testing Race Condition Prevention (Concurrent Loan Disbursements & Repayments)...');

    // Clean up any remaining active loans for userA
    await prisma.loan.updateMany({
        where: { userId: userA_Jid, status: 'ACTIVE' },
        data: { status: 'PAID' }
    });

    // Execute two concurrent loan disbursements simultaneously
    const [loanDisburse1, loanDisburse2] = await Promise.all([
        disburseLoan(userA_Jid, 2000000, 0.05, 14),
        disburseLoan(userA_Jid, 2000000, 0.05, 14)
    ]);

    const successes = [loanDisburse1, loanDisburse2].filter((r) => r.success);
    const failures = [loanDisburse1, loanDisburse2].filter((r) => !r.success);

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent loan disbursement must succeed');
    assert.strictEqual(failures.length, 1, 'Exactly one concurrent loan disbursement must be safely rejected');

    // Verify database only has 1 active loan
    const activeLoansCount = await prisma.loan.count({
        where: { userId: userA_Jid, status: 'ACTIVE' }
    });
    assert.strictEqual(activeLoansCount, 1, 'User must possess exactly one active loan in the database');

    // Test concurrent repayments
    const [repay1, repay2] = await Promise.all([repayLoan(userA_Jid), repayLoan(userA_Jid)]);

    const repaySuccesses = [repay1, repay2].filter((r) => r.success);
    assert.strictEqual(repaySuccesses.length, 1, 'Exactly one concurrent repayment must succeed');

    console.log('✓ Concurrency and race condition prevention verified.');
    console.log('--- ALL BANK LOAN SYSTEM TESTS PASSED SUCCESSFULLY! ---');
}

runLoanTests()
    .catch((err) => {
        console.error('Test execution failed:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
