/**
 * Daily audit digest collector.
 *
 * Aggregates counts and Rp-formatted sums from the audit tables. The digest is
 * strictly aggregate: no raw JIDs, phone numbers, or per-user identifiers are
 * ever included in the outbound payload.
 */
import { prisma } from '#db.js';
import { formatRupiah } from '#utils/currency.js';
import { notify } from './notifier.js';

export interface AuditDigest {
    windowHours: number;
    activityCount: number;
    activityVolume: number;
    bankTransactionCount: number;
    bankVolume: number;
    loanCreatedCount: number;
    loanVolume: number;
    loanDefaultedCount: number;
    ipAccessCount: number;
    failedIpAccessCount: number;
    paymentCount: number;
    paymentVolume: number;
}

/** Collects a sanitized aggregate digest over the given rolling window. */
export async function collectAuditDigest(windowHours = 24): Promise<AuditDigest> {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const [activityAgg, bankAgg, loanAgg, loanDefaulted, ipAccessCount, failedIpAccessCount, paymentAgg] =
        await Promise.all([
            prisma.activityLog.aggregate({
                where: { createdAt: { gte: since } },
                _count: { _all: true },
                _sum: { amount: true }
            }),
            prisma.bankTransaction.aggregate({
                where: { timestamp: { gte: since } },
                _count: { _all: true },
                _sum: { amount: true }
            }),
            prisma.loan.aggregate({
                where: { createdAt: { gte: since } },
                _count: { _all: true },
                _sum: { principalAmount: true }
            }),
            prisma.loan.count({ where: { status: 'DEFAULTED', updatedAt: { gte: since } } }),
            prisma.userIpAccessLog.count({ where: { createdAt: { gte: since } } }),
            prisma.userIpAccessLog.count({ where: { createdAt: { gte: since }, status: { not: 'SUCCESS' } } }),
            prisma.paymentTransaction.aggregate({
                where: { createdAt: { gte: since } },
                _count: { _all: true },
                _sum: { amount: true }
            })
        ]);

    const toNumber = (value: bigint | null | undefined): number => (value == null ? 0 : Number(value));

    return {
        windowHours,
        activityCount: activityAgg._count._all,
        activityVolume: toNumber(activityAgg._sum.amount),
        bankTransactionCount: bankAgg._count._all,
        bankVolume: toNumber(bankAgg._sum.amount),
        loanCreatedCount: loanAgg._count._all,
        loanVolume: toNumber(loanAgg._sum.principalAmount),
        loanDefaultedCount: loanDefaulted,
        ipAccessCount,
        failedIpAccessCount,
        paymentCount: paymentAgg._count._all,
        paymentVolume: toNumber(paymentAgg._sum.amount)
    };
}

/** Builds the sanitized notification payload for a digest. */
export function buildDigestPayload(digest: AuditDigest) {
    const anomalies: string[] = [];
    if (digest.loanDefaultedCount > 0) {
        anomalies.push(`${digest.loanDefaultedCount} loan(s) defaulted within the window.`);
    }
    if (digest.failedIpAccessCount > 5) {
        anomalies.push(`Elevated failed access attempts: ${digest.failedIpAccessCount}.`);
    }

    return {
        summary: `Audit digest for the last ${digest.windowHours} hours.`,
        details: anomalies.length > 0 ? anomalies : ['No anomalies detected.'],
        fields: {
            Activities: `${digest.activityCount} (${formatRupiah(digest.activityVolume)})`,
            'Bank transactions': `${digest.bankTransactionCount} (${formatRupiah(digest.bankVolume)})`,
            'Loans issued': `${digest.loanCreatedCount} (${formatRupiah(digest.loanVolume)})`,
            'Loans defaulted': `${digest.loanDefaultedCount}`,
            'IP access events': `${digest.ipAccessCount} (${digest.failedIpAccessCount} failed)`,
            Payments: `${digest.paymentCount} (${formatRupiah(digest.paymentVolume)})`
        },
        sessionId: 'default'
    };
}

/** Collects and dispatches the audit digest. Never throws. */
export async function sendAuditDigest(windowHours = 24): Promise<AuditDigest | null> {
    try {
        const digest = await collectAuditDigest(windowHours);
        await notify('AUDIT_DIGEST', 'INFO', buildDigestPayload(digest), {
            force: true,
            dedupeKey: `AUDIT_DIGEST:${new Date().toISOString().slice(0, 13)}`
        });
        return digest;
    } catch (err) {
        console.error('[StatusNotifier] Failed to send audit digest:', err);
        return null;
    }
}
