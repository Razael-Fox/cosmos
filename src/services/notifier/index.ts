/**
 * External Status Notification subsystem — public entry point.
 *
 * Wires together the transports, outbox, health monitor, database guard, audit
 * digest, and the process-level exception handlers. Importing this module has no
 * side effects; call `initStatusNotifier()` during startup.
 */
import cron from 'node-cron';
import { getStatusNotifierConfig, logStatusNotifierConfig } from './config.js';
import { notify, notifyTest, getChannelHealth } from './notifier.js';
import { emitBootLifecycle, installLifecycleShutdownHook } from './lifecycle.js';
import { recordIssue, flushIssues, startIssueLogger, stopIssueLogger } from './issueLogger.js';
import { startHealthMonitor, stopHealthMonitor, collectHealth } from './healthMonitor.js';
import { startDbGuard, stopDbGuard, inspectDatabase } from './dbGuard.js';
import { collectAuditDigest, sendAuditDigest } from './auditDigest.js';
import { startOutboxWorker, stopOutboxWorker, processOutboxBatch } from './outboxWorker.js';

export * from './types.js';
export {
    notify,
    notifyTest,
    getChannelHealth,
    emitBootLifecycle,
    installLifecycleShutdownHook,
    recordIssue,
    flushIssues,
    sendAuditDigest,
    collectAuditDigest,
    collectHealth,
    inspectDatabase,
    processOutboxBatch
};
export { getStatusNotifierConfig, logStatusNotifierConfig };

let initialized = false;
let digestTask: ReturnType<typeof cron.schedule> | null = null;
let handlersInstalled = false;

/**
 * Installs global `uncaughtException` / `unhandledRejection` handlers that
 * forward a redacted ISSUE_LOG before the process terminates.
 *
 * Safe to call multiple times; only the first registration takes effect.
 */
export function installGlobalErrorHandlers(): void {
    if (handlersInstalled) return;
    handlersInstalled = true;

    process.on('uncaughtException', (error) => {
        console.error('[StatusNotifier] uncaughtException:', error);
        recordIssue(error, { sessionId: 'default' });
        // Flush synchronously-ish, then exit so the supervisor can restart.
        void flushIssues(true).finally(() => process.exit(1));
        // Guard against a hung flush.
        setTimeout(() => process.exit(1), 5000).unref();
    });

    process.on('unhandledRejection', (reason) => {
        console.error('[StatusNotifier] unhandledRejection:', reason);
        // Record only; the 5-minute issue-logger worker flushes the batch.
        // (Unlike uncaughtException, this path does not exit the process.)
        recordIssue(reason, { sessionId: 'default' });
    });
}

/**
 * Boots the subsystem: validates config, starts the health monitor, database
 * guard, issue logger, outbox worker, and the audit digest cron. Registers the
 * global error handlers.
 */
export function initStatusNotifier(): void {
    if (initialized) return;
    initialized = true;

    logStatusNotifierConfig();
    installGlobalErrorHandlers();

    startHealthMonitor();
    startDbGuard();
    startIssueLogger();
    startOutboxWorker();

    const config = getStatusNotifierConfig();
    if (!digestTask) {
        digestTask = cron.schedule(config.auditDigestCronExpression, () => {
            void sendAuditDigest();
        });
        console.log(`[StatusNotifier] Audit digest scheduled (cron "${config.auditDigestCronExpression}").`);
    }

    console.log('[StatusNotifier] External status notification subsystem initialized.');
}

/** Stops all cron workers and unregisters nothing (handlers persist for the process life). */
export function shutdownStatusNotifier(): void {
    stopHealthMonitor();
    stopDbGuard();
    stopIssueLogger();
    stopOutboxWorker();
    if (digestTask) {
        digestTask.stop();
        digestTask = null;
    }
}

export { notifyTest as sendTestNotification };
