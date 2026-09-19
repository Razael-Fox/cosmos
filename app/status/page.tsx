'use client';

import React, { useState, useEffect } from 'react';
import {
    ArrowClockwise,
    ShieldCheck,
    DeviceMobile,
    UsersThree,
    Clock
} from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { Container } from '@/components/ui/container';
import { getSystemStatus } from '@/lib/api';
import type { SystemStatusResponse } from '@/lib/types';

export default function StatusPage() {
    const { t } = useTranslation();
    const [data, setData] = useState<SystemStatusResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleManualRefresh = async () => {
        setRefreshing(true);
        setError(null);
        try {
            const res = await getSystemStatus();
            setData(res);
        } catch (err) {
            console.error('[Status] Failed to fetch system status:', err);
            setError(t.common.networkError);
        } finally {
            setRefreshing(false);
        }
    };

    useEffect(() => {
        let isMounted = true;

        const loadStatus = async () => {
            try {
                const res = await getSystemStatus();
                if (isMounted) {
                    setData(res);
                    setError(null);
                }
            } catch (err) {
                console.error('[Status] Failed to fetch system status:', err);
                if (isMounted) {
                    setError(t.common.networkError);
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        void loadStatus();

        // Poll every 30 seconds for live updates
        const interval = setInterval(() => {
            void loadStatus();
        }, 30000);

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [t.common.networkError]);

    return (
        <div className="flex flex-col w-full min-h-screen py-10">
            <Container size="lg" className="space-y-10">
                {/* Header Title & Refresh Button */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border pb-6">
                    <div className="space-y-1.5">
                        <h1 className="text-3xl sm:text-4xl font-extrabold font-heading tracking-tight text-foreground">
                            {t.statusPage.title}
                        </h1>
                        <p className="text-xs sm:text-sm text-muted-foreground">{t.statusPage.subtitle}</p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={handleManualRefresh}
                            disabled={refreshing || loading}
                            className="px-4 py-2 rounded-xl bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                            <ArrowClockwise className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                            <span>{refreshing ? t.statusPage.refreshing : t.statusPage.refreshBtn}</span>
                        </button>
                    </div>
                </div>


                {/* Error Banner if API fails */}
                {error && (
                    <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-xs flex items-center justify-between gap-3">
                        <span>{error}</span>
                        <button
                            type="button"
                            onClick={handleManualRefresh}
                            className="font-bold underline hover:opacity-80 cursor-pointer"
                        >
                            {t.common.retry}
                        </button>
                    </div>
                )}

                {/* 4 Authentic Live Metric Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                    {/* Metric 1: Connected Sub-Bots */}
                    <div className="p-6 rounded-2xl bg-card border border-border shadow-xs space-y-3">
                        <div className="flex items-center justify-between text-muted-foreground">
                            <span className="text-xs font-semibold uppercase tracking-wider">
                                {t.statusPage.subbotsTitle}
                            </span>
                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                <DeviceMobile className="w-4 h-4" />
                            </div>
                        </div>
                        <div>
                            <p className="text-3xl font-extrabold font-mono text-foreground">
                                {loading ? '...' : (data?.connectedSubBots.activeCount ?? 0)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {data
                                    ? `${data.connectedSubBots.totalConfigured} configured sessions`
                                    : t.statusPage.subbotsDesc}
                            </p>
                        </div>
                    </div>

                    {/* Metric 2: System Uptime */}
                    <div className="p-6 rounded-2xl bg-card border border-border shadow-xs space-y-3">
                        <div className="flex items-center justify-between text-muted-foreground">
                            <span className="text-xs font-semibold uppercase tracking-wider">
                                {t.statusPage.uptimeTitle}
                            </span>
                            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
                                <Clock className="w-4 h-4" />
                            </div>
                        </div>
                        <div>
                            <p className="text-3xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400">
                                {loading ? '...' : `${data?.uptime.percentage.toFixed(1) ?? '99.9'}%`}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {data?.uptime.humanReadable ?? t.statusPage.uptimeDesc}
                            </p>
                        </div>
                    </div>

                    {/* Metric 3: Whitelisted Groups */}
                    <div className="p-6 rounded-2xl bg-card border border-border shadow-xs space-y-3">
                        <div className="flex items-center justify-between text-muted-foreground">
                            <span className="text-xs font-semibold uppercase tracking-wider">
                                {t.statusPage.groupsTitle}
                            </span>
                            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500">
                                <UsersThree className="w-4 h-4" />
                            </div>
                        </div>
                        <div>
                            <p className="text-3xl font-extrabold font-mono text-foreground">
                                {loading ? '...' : (data?.whitelistedGroups.totalCount ?? 0)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">{t.statusPage.groupsDesc}</p>
                        </div>
                    </div>

                    {/* Metric 4: Spam-Ban Incidence */}
                    <div className="p-6 rounded-2xl bg-card border border-border shadow-xs space-y-3">
                        <div className="flex items-center justify-between text-muted-foreground">
                            <span className="text-xs font-semibold uppercase tracking-wider">
                                {t.statusPage.banTitle}
                            </span>
                            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
                                <ShieldCheck className="w-4 h-4" />
                            </div>
                        </div>
                        <div>
                            <p className="text-3xl font-extrabold font-mono text-foreground">
                                {loading ? '...' : (data?.spamBanIncidence.incidentsReported ?? 0)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {data?.spamBanIncidence.statusText ?? t.statusPage.banDesc}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Individual Service Health Table */}
                <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden space-y-4">
                    <div className="p-6 border-b border-border space-y-1">
                        <h2 className="text-lg font-bold text-foreground">{t.statusPage.servicesTitle}</h2>
                        <p className="text-xs text-muted-foreground">{t.statusPage.servicesDesc}</p>
                    </div>

                    <div className="divide-y divide-border">
                        {(data?.services ?? []).map((service, idx) => (
                            <div
                                key={idx}
                                className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/30 transition-colors"
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-bold text-foreground">{service.name}</p>
                                    </div>
                                    <p className="text-xs text-muted-foreground">{service.description}</p>
                                </div>

                                <div className="flex items-center gap-3 shrink-0">
                                    {typeof service.latencyMs === 'number' && (
                                        <span className="text-xs font-mono text-muted-foreground px-2 py-0.5 rounded-md bg-muted border border-border">
                                            {service.latencyMs}ms {t.statusPage.latency}
                                        </span>
                                    )}

                                    <span
                                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold ${
                                            service.status === 'OPERATIONAL'
                                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                                : service.status === 'DEGRADED'
                                                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                        }`}
                                    >
                                        <span
                                            className={`w-1.5 h-1.5 rounded-full ${
                                                service.status === 'OPERATIONAL'
                                                    ? 'bg-emerald-500'
                                                    : service.status === 'DEGRADED'
                                                      ? 'bg-amber-500'
                                                      : 'bg-rose-500'
                                            }`}
                                        />
                                        <span>
                                            {service.status === 'OPERATIONAL'
                                                ? t.statusPage.operational
                                                : service.status === 'DEGRADED'
                                                  ? t.statusPage.degraded
                                                  : t.statusPage.outage}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </Container>
        </div>
    );
}
