import dns from 'dns';
import dotenv from 'dotenv';
import { loadAutoDlSettings } from '#utils/autodl.js';
import toolsHandler from '#tools/handler.js';

import { startAutoBackup } from '#utils/backup.js';
import { startBankInterestCron } from '#services/bankService.js';
import { startLoanSchedulerCron } from '#services/loanService.js';
import { connectToWhatsApp, activeConnections } from '#utils/connectionManager.js';
import { isDefaultSessionRegistered, promptBotPhoneNumber, promptPairingMethod } from '#utils/startupPrompt.js';
import { getTelegramClient, isTelegramConfigured } from '#utils/telegramClient.js';
import { seedItems } from '#seed_item.js';
import { seedProperties } from '#seed_property.js';

dns.setDefaultResultOrder('ipv4first');

dotenv.config();

// Start auto backup (on startup and daily at 00:00 WIB)
startAutoBackup();

// Start scheduled daily bank interest distribution (daily at 00:00 WIB)
startBankInterestCron();

// Start scheduled loan monitoring & 5-day reminders (hourly)
startLoanSchedulerCron(() => activeConnections.get('default'));

// Start secure Bot IPC server (Unix Domain Socket) for API Gateway orchestration.
try {
    const { startIpcServer } = await import('#services/ipcServer.js');
    startIpcServer();
} catch (err) {
    console.error('[System] Failed to start IPC server:', err);
}

// Daily subscription expiry reconciliation (00:00 UTC) with graceful downgrade.
try {
    const { default: cron } = await import('node-cron');
    const { reconcileSubscriptions } = await import('#services/subscriptionChecker.js');
    cron.schedule('0 0 * * *', () => {
        reconcileSubscriptions().catch((err) => console.error('[Subscriptions] Reconciliation failed:', err));
    });
    console.log('[System] Subscription expiry checker scheduled (daily 00:00 UTC).');
} catch (err) {
    console.error('[System] Failed to schedule subscription checker:', err);
}

async function startSystem(): Promise<void> {
    await toolsHandler.loadTools();
    await loadAutoDlSettings();

    // Sync shop items and property catalog on every startup so new
    // entries and price updates reach existing databases (both seeders
    // are idempotent and safe to re-run).
    try {
        console.log('[System] Syncing shop items and property catalog...');
        await seedItems();
        await seedProperties();
    } catch (err) {
        console.error('[System] Error syncing shop items and property catalog:', err);
    }

    // Connect the Telegram dummy account in the background when it has been paired,
    // so private group content can be proxied.
    if (isTelegramConfigured()) {
        getTelegramClient()
            .then(() => console.log('[System] Telegram dummy account ready for private media proxying.'))
            .catch((err) => console.error('[System] Telegram dummy account failed to connect:', err));
    } else {
        console.log('[System] Telegram dummy account is not configured; private content proxying is disabled.');
    }

    console.log('[System] Checking default session credentials...');
    const isRegistered = await isDefaultSessionRegistered();
    if (isRegistered) {
        // Connect default bot silently with the existing registered session
        connectToWhatsApp({
            sessionId: 'default'
        });
    } else {
        console.log('[System] No registered session found. Pairing is required.');
        const botNumber = await promptBotPhoneNumber();
        const pairingMethod = await promptPairingMethod();

        // Connect default bot in pairing mode with runtime-selected values
        connectToWhatsApp({
            sessionId: 'default',
            phoneNumber: botNumber,
            pairingMethod,
            isPairingMode: true
        });
    }

    // Automatically reconnect existing paired sub-bots with staggered intervals
    const { initSubBots } = await import('#services/subBotService.js');
    initSubBots();
}

startSystem();
