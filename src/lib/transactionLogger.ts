import fs from 'fs';
import path from 'path';

const TRANSACTION_DIR = path.join(process.cwd(), 'storage', 'transaction');

/**
 * Logs a coin transfer transaction to a daily file in JSON Lines (JSONL) format.
 * @param senderJid The JID of the sender
 * @param receiverJid The JID of the receiver
 * @param amount The amount of coins transferred
 */
export function logTransaction(senderJid: string, receiverJid: string, amount: number) {
    try {
        if (!fs.existsSync(TRANSACTION_DIR)) {
            fs.mkdirSync(TRANSACTION_DIR, { recursive: true });
        }

        const date = new Date();
        const dateString = date.toISOString().split('T')[0];
        const logFile = path.join(TRANSACTION_DIR, `transfers_${dateString}.jsonl`);

        const logEntry = {
            timestamp: date.toISOString(),
            type: 'transfer',
            sender: senderJid,
            receiver: receiverJid,
            amount: amount
        };

        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n', 'utf-8');
    } catch (error) {
        console.error('[TransactionLogger] Failed to log transaction:', error);
    }
}
