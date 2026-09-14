import assert from 'assert';
import { prisma } from '../src/db.js';
import { saveIdCard } from '../src/utils/idCard.js';
import {
    registerBankAccount,
    depositToBank,
    withdrawFromBank,
    validateTransferPreconditions,
    executeTransfer,
    getBankStatement,
    distributeDailyInterest,
    getDailyTransferTotal,
    BANK_REGISTRATION_FEE,
    BANK_TRANSFER_FEE,
    BANK_DAILY_TRANSFER_LIMIT
} from '../src/services/bankService.js';
import bankTool, { processBankTransferConfirmation, getPendingTransfer } from '../src/tools/bank.js';
import { cancelActiveSession } from '../src/utils/cancellationManager.js';
import { getTranslator } from '../src/utils/i18n.js';

async function runBankTests() {
    console.log('--- STARTING BANKING SYSTEM TESTS ---');
    const t = getTranslator('en');

    const timestamp = Date.now();
    const userA_Jid = `user_a_${timestamp}@s.whatsapp.net`;
    const userB_Jid = `user_b_${timestamp}@s.whatsapp.net`;
    const userNoKtp_Jid = `user_noktp_${timestamp}@s.whatsapp.net`;
    const chatJid = `chat_${timestamp}@g.us`;

    // 1. Setup initial users in database
    console.log('[Test 1] Setting up users & ID Card requirements...');
    await prisma.user.create({
        data: {
            id: userA_Jid,
            pushName: 'Alice Banker',
            balance: BigInt(100000) // 100k cash
        }
    });

    await prisma.user.create({
        data: {
            id: userB_Jid,
            pushName: 'Bob Trader',
            language: 'EN',
            balance: BigInt(50000) // 50k cash
        }
    });

    await prisma.user.create({
        data: {
            id: userNoKtp_Jid,
            pushName: 'No KTP User',
            balance: BigInt(50000)
        }
    });

    // Provide ID Card only for User A and User B
    await saveIdCard({
        nik: `317101170890${String(timestamp % 9000).padStart(4, '0')}`,
        userJid: userA_Jid,
        fullName: 'Alice Banker',
        placeOfBirth: 'JAKARTA',
        dateOfBirth: '17-08-1990',
        gender: 'PEREMPUAN',
        address: 'Cosmos Financial Street No. 1',
        religion: 'ISLAM',
        maritalStatus: 'BELUM KAWIN',
        occupation: 'INVESTOR',
        citizenship: 'WNI',
        validUntil: 'SEUMUR HIDUP'
    });

    const bobSeq = String((timestamp + 1) % 9000).padStart(4, '0');
    await saveIdCard({
        nik: `317101201192${bobSeq}`,
        userJid: userB_Jid,
        fullName: 'Bob Trader',
        placeOfBirth: 'SURABAYA',
        dateOfBirth: '20-11-1992',
        gender: 'LAKI-LAKI',
        address: 'Cosmos Commercial Ave No. 2',
        religion: 'KRISTEN',
        maritalStatus: 'KAWIN',
        occupation: 'BROKER',
        citizenship: 'WNI',
        validUntil: 'SEUMUR HIDUP'
    });

    console.log('✓ Users and ID Cards set up successfully.');

    // 2. Test Registration Requirement Gates
    console.log('[Test 2] Testing Bank Registration Gates (KTP gate, fee deduction, duplicate prevention)...');
    // User without KTP must be rejected
    const noKtpResult = await registerBankAccount(userNoKtp_Jid, 'No KTP User', t);
    assert.strictEqual(noKtpResult.success, false);
    assert(noKtpResult.error?.includes('Access denied'));

    // User A registers successfully
    const regA = await registerBankAccount(userA_Jid, 'Alice Banker', t);
    assert.strictEqual(regA.success, true);
    assert(regA.accountNumber, 'Account number must be generated');
    assert.strictEqual(regA.accountNumber.length, 10, 'Account number must be 10 digits');

    // Verify pocket cash deduction of BANK_REGISTRATION_FEE (Rp10.000)
    const freshUserA = await prisma.user.findUnique({ where: { id: userA_Jid } });
    assert.strictEqual(Number(freshUserA?.balance), 100000 - BANK_REGISTRATION_FEE);

    // Verify initial bank balance is 0 and status ACTIVE
    const bankAccountA = await prisma.bankAccount.findUnique({ where: { userJid: userA_Jid } });
    assert.strictEqual(Number(bankAccountA?.balance), 0);
    assert.strictEqual(bankAccountA?.status, 'ACTIVE');

    // Duplicate registration attempt must fail
    const dupRegA = await registerBankAccount(userA_Jid, 'Alice Banker', t);
    assert.strictEqual(dupRegA.success, false);
    assert(dupRegA.error?.includes('already possess'));

    // Register User B
    const regB = await registerBankAccount(userB_Jid, 'Bob Trader', t);
    assert.strictEqual(regB.success, true);
    const accNumberA = regA.accountNumber!;
    const accNumberB = regB.accountNumber!;
    console.log('✓ Bank registration and fee deductions verified.');

    // 3. Test Deposit Operations
    console.log('[Test 3] Testing Deposit Operations & ACID guarantees...');
    // Alice deposits Rp50.000
    const depResult = await depositToBank(userA_Jid, 50000, t);
    assert.strictEqual(depResult.success, true);
    assert.strictEqual(Number(depResult.newBankBalance), 50000);

    const userAPostDep = await prisma.user.findUnique({ where: { id: userA_Jid } });
    assert.strictEqual(Number(userAPostDep?.balance), 90000 - 50000); // 40k left in cash

    // Attempting to deposit more than available cash must fail
    const overDep = await depositToBank(userA_Jid, 100000, t);
    assert.strictEqual(overDep.success, false);
    assert(overDep.error?.includes('sufficient cash on hand'));
    console.log('✓ Deposit operations verified successfully.');

    // 4. Test Withdrawal Operations
    console.log('[Test 4] Testing Withdrawal Operations...');
    // Alice withdraws Rp20.000
    const wdResult = await withdrawFromBank(userA_Jid, 20000, t);
    assert.strictEqual(wdResult.success, true);
    assert.strictEqual(Number(wdResult.newBankBalance), 30000);

    const userAPostWd = await prisma.user.findUnique({ where: { id: userA_Jid } });
    assert.strictEqual(Number(userAPostWd?.balance), 40000 + 20000); // 60k cash

    // Attempting to withdraw more than bank balance must fail
    const overWd = await withdrawFromBank(userA_Jid, 50000, t);
    assert.strictEqual(overWd.success, false);
    assert(overWd.error?.includes('does not have sufficient funds'));
    console.log('✓ Withdrawal operations verified successfully.');

    // 5. Test Bank Transfer Validations & Execution
    console.log('[Test 5] Testing Transfer Validations, Preconditions & ACID Execution...');
    // Current Alice bank balance: 30000. Transfer fee: 500.
    // Self-transfer must fail
    const selfTf = await validateTransferPreconditions(userA_Jid, accNumberA, 10000, t);
    assert.strictEqual(selfTf.valid, false);
    assert(selfTf.error?.includes('own bank account'));

    // Non-existent target account must fail
    const nonExistentTf = await validateTransferPreconditions(userA_Jid, '9999999999', 10000, t);
    assert.strictEqual(nonExistentTf.valid, false);
    assert(nonExistentTf.error?.includes('does not exist'));

    // Transfer amount + fee exceeds balance
    const overTf = await validateTransferPreconditions(userA_Jid, accNumberB, 30000, t);
    assert.strictEqual(overTf.valid, false);
    assert(overTf.error?.includes('sufficient funds'));

    // Valid transfer precondition: Alice transfers Rp10.000 to Bob
    const validPre = await validateTransferPreconditions(userA_Jid, accNumberB, 10000, t);
    assert.strictEqual(validPre.valid, true);
    assert.strictEqual(validPre.targetAccount?.accountNumber, accNumberB);
    assert.strictEqual(validPre.targetAccount?.fullName, 'BOB TRADER');

    // Execute transfer
    const tfResult = await executeTransfer(accNumberA, accNumberB, 10000, t);
    assert.strictEqual(tfResult.success, true);
    assert.strictEqual(Number(tfResult.newBankBalance), 30000 - 10000 - BANK_TRANSFER_FEE);

    const bankAccBPost = await prisma.bankAccount.findUnique({ where: { accountNumber: accNumberB } });
    assert.strictEqual(Number(bankAccBPost?.balance), 10000);

    // Verify ledger records
    const txSenderOut = await prisma.bankTransaction.findFirst({
        where: { accountNumber: accNumberA, type: 'TRANSFER_OUT' }
    });
    assert(txSenderOut, 'TRANSFER_OUT transaction must be recorded for sender');
    assert.strictEqual(Number(txSenderOut.amount), 10000);

    const txSenderFee = await prisma.bankTransaction.findFirst({
        where: { accountNumber: accNumberA, type: 'FEE', relatedAccount: accNumberB }
    });
    assert(txSenderFee, 'FEE transaction must be recorded for transfer');
    assert.strictEqual(Number(txSenderFee.amount), BANK_TRANSFER_FEE);

    const txReceiverIn = await prisma.bankTransaction.findFirst({
        where: { accountNumber: accNumberB, type: 'TRANSFER_IN' }
    });
    assert(txReceiverIn, 'TRANSFER_IN transaction must be recorded for receiver');
    assert.strictEqual(Number(txReceiverIn.amount), 10000);

    console.log('✓ Transfer operations & ledger records verified successfully.');

    // 6. Test Daily Transfer Limit
    console.log('[Test 6] Testing Daily Transfer Limit...');
    const dailyTotal = await getDailyTransferTotal(accNumberA);
    assert.strictEqual(Number(dailyTotal), 10000);

    // Deposit massive amount to test daily limit boundary
    await prisma.bankAccount.update({
        where: { accountNumber: accNumberA },
        data: { balance: BigInt(100000000) }
    });
    const limitExceed = await validateTransferPreconditions(userA_Jid, accNumberB, BANK_DAILY_TRANSFER_LIMIT, t);
    assert.strictEqual(limitExceed.valid, false);
    assert(limitExceed.error?.includes('daily transfer limit'));
    console.log('✓ Daily transfer limits verified.');

    // 7. Test Statement & Balance Inquiry
    console.log('[Test 7] Testing Statement & Balance Inquiry...');
    const statement = await getBankStatement(userA_Jid);
    assert(statement, 'Statement should exist');
    assert.strictEqual(statement.fullName, 'ALICE BANKER');
    assert.strictEqual(statement.accountNumber, accNumberA);
    assert(statement.transactions.length >= 3, 'Should show recent transactions');
    console.log('✓ Bank statement verified.');

    // 8. Test Interactive Command & Global Cancellation
    console.log('[Test 8] Testing Interactive Transfer Confirmation & .cancel flow...');
    const fakeSock: any = {
        sentMessages: [] as any[],
        sendMessage: async (jid: string, content: any, opts?: any) => {
            fakeSock.sentMessages.push({ jid, content, opts });
        }
    };

    // User A triggers .bank transfer
    const fakeMsg = {
        key: { remoteJid: chatJid, participant: userA_Jid, fromMe: false },
        message: {
            conversation: `.bank transfer ${accNumberB} 5000`
        },
        pushName: 'Alice Banker'
    };

    const toolPrompt = await bankTool.execute({}, { sock: fakeSock, msg: fakeMsg as any, jid: chatJid, t });
    assert(typeof toolPrompt === 'string');
    assert(toolPrompt.includes('confirm'), 'Prompt must instruct user to reply confirm');
    assert(toolPrompt.includes('.cancel'), 'Prompt must instruct user they can cancel');

    // Pending transfer should be active in session
    const pending = getPendingTransfer(userA_Jid, chatJid);
    assert(pending, 'Pending transfer must be stored in registry');
    assert.strictEqual(pending.amount, 5000);

    // Cancel using global cancellationManager
    const cancelResult = await cancelActiveSession(userA_Jid, chatJid, fakeSock, fakeMsg);
    assert(cancelResult, 'Cancellation must succeed');
    assert(cancelResult.includes('successfully cancelled'));

    // Verify pending transfer has been cleared
    const pendingAfterCancel = getPendingTransfer(userA_Jid, chatJid);
    assert.strictEqual(pendingAfterCancel, undefined, 'Pending transfer must be cleaned up');

    // Now test confirming a transfer
    await bankTool.execute({}, { sock: fakeSock, msg: fakeMsg as any, jid: chatJid, t });
    assert(getPendingTransfer(userA_Jid, chatJid), 'Pending transfer registered again');

    const confirmed = await processBankTransferConfirmation(fakeSock, fakeMsg, userA_Jid, chatJid, 'confirm', t);
    assert.strictEqual(confirmed, true, 'Confirmation must be processed');

    // Verify confirmation cleaned up session
    assert.strictEqual(getPendingTransfer(userA_Jid, chatJid), undefined);

    // Verify sent messages include sender reply and async recipient notification
    const senderMsg = fakeSock.sentMessages.find(
        (m: any) => m.jid === chatJid && m.content.text?.includes('Transfer successful')
    );
    assert(senderMsg, 'Sender must receive success confirmation');

    // Wait 500ms for async recipient notification to trigger
    await new Promise((resolve) => setTimeout(resolve, 500));
    const recipientMsg = fakeSock.sentMessages.find(
        (m: any) =>
            m.content.text?.includes('You have received a transfer') ||
            m.content.text?.includes('Anda menerima transfer dana')
    );
    assert(recipientMsg, 'Recipient notification must be dispatched');
    console.log('✓ Interactive confirmation and cancellation flows verified.');

    // 9. Test Interest Distribution Cron Job
    console.log('[Test 9] Testing Compound Interest Distribution...');
    const interestRun = await distributeDailyInterest();
    assert(interestRun.accountsProcessed >= 2, 'Active positive accounts must receive interest');
    assert(interestRun.totalInterestPaid > BigInt(0), 'Interest must be credited');

    const txInterest = await prisma.bankTransaction.findFirst({
        where: { accountNumber: accNumberB, type: 'INTEREST' }
    });
    assert(txInterest, 'Interest transaction must be logged in bank ledger');
    console.log('✓ Interest distribution verified successfully.');

    console.log('--- ALL BANKING SYSTEM TESTS PASSED SUCCESSFULLY! ---');
}

runBankTests()
    .catch((err) => {
        console.error('Test failed with error:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
