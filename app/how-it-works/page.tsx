'use client';

import React, { useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
    ArrowLeft,
    ArrowRight,
    ShieldCheck,
    WhatsappLogo,
    DeviceMobile,
    CheckCircle,
    QrCode,
    Sparkle
} from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { Container } from '@/components/ui/container';

function subscribeToAuth(callback: () => void) {
    window.addEventListener('storage', callback);
    return () => window.removeEventListener('storage', callback);
}

function getAuthSnapshot(): boolean {
    if (typeof window === 'undefined') return false;
    return !!localStorage.getItem('cosmos_jwt_token');
}

function getAuthServerSnapshot(): boolean {
    return false;
}

export default function HowItWorksPage() {
    const { t } = useTranslation();
    const isAuthenticated = useSyncExternalStore(subscribeToAuth, getAuthSnapshot, getAuthServerSnapshot);

    return (
        <div className="flex flex-col w-full min-h-screen py-10">
            <Container size="lg" className="space-y-12">
                {/* Back to Home */}
                <div>
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span>{t.statusPage.backHome}</span>
                    </Link>
                </div>

                {/* Hero Header */}
                <div className="text-center max-w-3xl mx-auto space-y-4">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-semibold tracking-wide">
                        <Sparkle className="w-3.5 h-3.5" weight="bold" />
                        <span>{t.howItWorksPage.badge}</span>
                    </div>
                    <h1 className="text-3xl sm:text-5xl font-extrabold font-heading tracking-tight text-foreground">
                        {t.howItWorks.title}
                    </h1>
                    <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                        {t.howItWorks.subtitle}
                    </p>
                </div>

                {/* 3 Simple Steps Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
                    {/* Step 1 */}
                    <div className="p-6 sm:p-8 rounded-3xl bg-card border border-border shadow-xs space-y-4 hover:border-primary/50 transition-colors flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary font-bold flex items-center justify-center font-mono text-lg">
                                1
                            </div>
                            <h2 className="text-xl font-bold text-foreground">{t.howItWorks.step1Title}</h2>
                            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                                {t.howItWorks.step1Desc}
                            </p>
                        </div>
                        <div className="pt-4 border-t border-border/60 flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            <CheckCircle className="w-4 h-4" weight="fill" />
                            <span>Cloudflare Turnstile Guard</span>
                        </div>
                    </div>

                    {/* Step 2 */}
                    <div className="p-6 sm:p-8 rounded-3xl bg-card border border-border shadow-xs space-y-4 hover:border-primary/50 transition-colors flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary font-bold flex items-center justify-center font-mono text-lg">
                                2
                            </div>
                            <h2 className="text-xl font-bold text-foreground">{t.howItWorks.step2Title}</h2>
                            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                                {t.howItWorks.step2Desc}
                            </p>
                        </div>
                        <div className="pt-4 border-t border-border/60 flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            <WhatsappLogo className="w-4 h-4" weight="fill" />
                            <span>Zero Spam-Ban Risk</span>
                        </div>
                    </div>

                    {/* Step 3 */}
                    <div className="p-6 sm:p-8 rounded-3xl bg-card border border-border shadow-xs space-y-4 hover:border-primary/50 transition-colors flex flex-col justify-between">
                        <div className="space-y-4">
                            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary font-bold flex items-center justify-center font-mono text-lg">
                                3
                            </div>
                            <h2 className="text-xl font-bold text-foreground">{t.howItWorks.step3Title}</h2>
                            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                                {t.howItWorks.step3Desc}
                            </p>
                        </div>
                        <div className="pt-4 border-t border-border/60 flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            <QrCode className="w-4 h-4" weight="bold" />
                            <span>Official Baileys Multi-Device</span>
                        </div>
                    </div>
                </div>

                {/* Deep Dive Architecture Explainer */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 pt-4">
                    <div className="p-8 rounded-3xl bg-card border border-border space-y-4 shadow-xs">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                            <ShieldCheck className="w-6 h-6" weight="duotone" />
                        </div>
                        <h3 className="text-xl font-bold text-foreground">{t.howItWorksPage.whyTitle}</h3>
                        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                            {t.howItWorksPage.whyDesc}
                        </p>
                    </div>

                    <div className="p-8 rounded-3xl bg-card border border-border space-y-4 shadow-xs">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                            <DeviceMobile className="w-6 h-6" weight="duotone" />
                        </div>
                        <h3 className="text-xl font-bold text-foreground">{t.howItWorksPage.pairingTitle}</h3>
                        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                            {t.howItWorksPage.pairingDesc}
                        </p>
                    </div>
                </div>

                {/* Bottom CTA Card */}
                <div className="rounded-3xl border border-emerald-500/30 dark:border-emerald-400/25 bg-gradient-to-br from-card via-card to-emerald-950/30 dark:from-[#0d1713] dark:via-[#101c17] dark:to-[#08120e] p-8 sm:p-12 flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl shadow-emerald-950/40 dark:shadow-emerald-950/60 overflow-hidden cosmos-grid">
                    <div className="space-y-3 text-center md:text-left max-w-xl">
                        <h2 className="text-2xl sm:text-3xl font-extrabold font-heading text-foreground">
                            {t.howItWorksPage.readyTitle}
                        </h2>
                        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                            {t.howItWorksPage.readyDesc}
                        </p>
                    </div>

                    <div className="shrink-0">
                        {isAuthenticated ? (
                            <Link
                                href="/dashboard"
                                className="px-7 py-3.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm shadow-md transition-all flex items-center gap-2"
                            >
                                <span>{t.howItWorksPage.dashboardBtn}</span>
                                <ArrowRight className="w-4 h-4" />
                            </Link>
                        ) : (
                            <Link
                                href="/register"
                                className="px-7 py-3.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm shadow-md transition-all flex items-center gap-2"
                            >
                                <span>{t.howItWorksPage.ctaBtn}</span>
                                <ArrowRight className="w-4 h-4" />
                            </Link>
                        )}
                    </div>
                </div>
            </Container>
        </div>
    );
}
