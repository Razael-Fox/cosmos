'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    CheckCircle,
    WarningCircle,
    XCircle,
    ArrowClockwise,
    ShieldCheck,
    DeviceMobile,
    UsersThree,
    Clock,
    ArrowLeft,
    Pulse
} from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { Container } from '@/components/ui/container';
import { getSystemStatus } from '@/lib/api';
import type { SystemStatusResponse } from '@/lib/types';

export default function StatusPage() {
    const { t } = useTranslation();
    const router = useRouter();
    const [data, setData] = useState<SystemStatusResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleBack = useCallback(() => {
        if (typeof window !== 'undefined' && window.history.length > 1) {
            router.back();
        } else {
            router.push('/');
        }
    }, [router]);

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

    // Enable edge-swipe ("slide back") gesture for comfortable one-handed mobile navigation
    useEffect(() => {
        let touchStartX = 0;
        let touchStartY = 0;
        let isEligible = false;

        const handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            // Only trigger if starting near the left edge (<= 45px)
            if (touch.clientX <= 45) {
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
                isEligible = true;
            } else {
                isEligible = false;
            }
        };

        const handleTouchEnd = (e: TouchEvent) => {
            if (!isEligible || e.changedTouches.length !== 1) return;
            const touch = e.changedTouches[0];
            const deltaX = touch.clientX - touchStartX;
            const deltaY = Math.abs(touch.clientY - touchStartY);

            // Horizontal swipe right of at least 70px with limited vertical drift
            if (deltaX > 70 && deltaY < 80) {
                handleBack();
            }
            isEligible = false;
        };

        window.addEventListener('touchstart', handleTouchStart, { passive: true });
        window.addEventListener('touchend', handleTouchEnd, { passive: true });

        return () => {
            window.removeEventListener('touchstart', handleTouchStart);
            window.removeEventListener('touchend', handleTouchEnd);
        };
    }, [handleBack]);

    const statusBanner = () => {
        if (!data || data.status === 'ALL_OPERATIONAL') {
            return {
                bg: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-400',
                indicator: 'bg-emerald-500',
                title: t.statusPage.allOperational,
                icon: <CheckCircle className="w-5 h-5 text-emerald-500" weight="fill" />
            };
        }
        if (data.status === 'PARTIAL_OUTAGE') {
            return {
                bg: 'bg-amber-500/10 border-amber-500/25 text-amber-700 dark:text-amber-400',
                indicator: 'bg-amber-500',
                title: t.statusPage.partialOutage,
                icon: <WarningCircle className="w-5 h-5 text-amber-500" weight="fill" />
            };
        }
        return {
            bg: 'bg-rose-500/10 border-rose-500/25 text-rose-700 dark:text-rose-400',
            indicator: 'bg-rose-500',
            title: t.statusPage.majorOutage,
            icon: <XCircle className="w-5 h-5 text-rose-500" weight="fill" />
        };
    };

    const banner = statusBanner();

    return (
        <div className="flex flex-col w-full min-h-screen py-10">
            <Container size="lg" className="space-y-10">
                {/* Navigation Native Back Button */}
                <div className="flex items-center justify-between">
                    <button
                        type="button"
                        onClick={handleBack}
                        className="group inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-border bg-card/70 hover:bg-muted text-xs font-semibold text-foreground transition-all shadow-xs cursor-pointer touch-manipulation active:scale-95"
                        aria-label={t.statusPage.back}
                    >
                        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
                        <span>{t.statusPage.back}</span>
                    </button>

                    <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/70 font-mono">
                        <span>{t.statusPage.slideBackHint}</span>
                    </span>
                </div>

                {/* Header Title & Refresh Button */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border pb-6">
                    <div className="space-y-1.5">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                            <Pulse className="w-3.5 h-3.5" weight="bold" />
                            <span>Telemetry Service</span>
                        </div>
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

                {/* Overall Health Banner */}
                <div
                    className={`rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 backdrop-blur-xs transition-all ${banner.bg}`}
                >
                    <div className="flex items-center gap-3.5">
                        <div className="p-2 rounded-xl bg-background/50 backdrop-blur-xs">{banner.icon}</div>
                        <div>
                            <p className="text-base sm:text-lg font-bold text-foreground">{banner.title}</p>
                            <p className="text-xs text-muted-foreground">
                                {t.statusPage.lastChecked}{' '}
                                {data?.lastChecked ? new Date(data.lastChecked).toLocaleTimeString() : '...'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-center text-xs font-mono font-medium">
                        <span className="relative flex h-2.5 w-2.5">
                            <span
                                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${banner.indicator}`}
                            />
                            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${banner.indicator}`} />
                        </span>
                        <span>{data?.uptime.percentage.toFixed(2) ?? '99.98'}% Availability</span>
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
                                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
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

            {/* One-Handed Mobile Floating Back Button (Thumb Zone) */}
            <div className="fixed bottom-6 left-5 z-40 sm:hidden">
                <button
                    type="button"
                    onClick={handleBack}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-card/95 backdrop-blur-md border border-border shadow-lg text-foreground font-semibold text-xs active:scale-95 transition-all touch-manipulation cursor-pointer"
                    aria-label={t.statusPage.back}
                >
                    <ArrowLeft className="w-4 h-4 text-primary" weight="bold" />
                    <span>{t.statusPage.back}</span>
                </button>
            </div>
        </div>
    );
}
