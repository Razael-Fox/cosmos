'use client';

import React, { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle, Check } from '@phosphor-icons/react';
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

export default function HomePage() {
    const { t, language } = useTranslation();

    const isAuthenticated = useSyncExternalStore(subscribeToAuth, getAuthSnapshot, getAuthServerSnapshot);

    return (
        <div className="flex flex-col w-full">
            {/* Centered Hero Section */}
            <section className="relative overflow-hidden pt-16 pb-20 md:py-28 border-b border-border cosmos-grid cosmos-glow">
                <Container size="lg">
                    <div className="max-w-3xl mx-auto flex flex-col items-center text-center space-y-6">
                        {/* H1 Heading */}
                        <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-foreground font-heading leading-[1.12]">
                            {t.hero.title}
                        </h1>

                        {/* Subtitle */}
                        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-2xl">
                            {t.hero.subtitle}
                        </p>

                        {/* Auth-aware CTAs */}
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto pt-2">
                            {isAuthenticated ? (
                                <Link
                                    href="/dashboard"
                                    className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <span>{t.nav.dashboard}</span>
                                    <ArrowRight className="w-4 h-4" />
                                </Link>
                            ) : (
                                <Link
                                    href="/register"
                                    className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <span>{t.hero.ctaRegister}</span>
                                    <ArrowRight className="w-4 h-4" />
                                </Link>
                            )}

                            <Link
                                href="/how-it-works"
                                className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-card hover:bg-muted text-foreground font-semibold text-sm border border-border shadow-xs transition-all flex items-center justify-center gap-2"
                            >
                                <span>{t.hero.ctaHowItWorks}</span>
                            </Link>
                        </div>

                        {/* Trust Badges */}
                        <div className="flex flex-wrap items-center justify-center gap-4 pt-4 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                                <CheckCircle className="w-4 h-4 text-emerald-500" weight="fill" />
                                <span>{t.hero.trustFree}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <CheckCircle className="w-4 h-4 text-emerald-500" weight="fill" />
                                <span>{t.hero.trustNoCard}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <CheckCircle className="w-4 h-4 text-emerald-500" weight="fill" />
                                <span>{t.hero.trustPayment}</span>
                            </div>
                        </div>
                    </div>
                </Container>
            </section>

            {/* Pricing Teaser Section */}
            <section className="py-20 border-b border-border bg-muted/10">
                <Container size="lg" className="space-y-10">
                    <div className="text-center max-w-2xl mx-auto space-y-3">
                        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground font-heading">
                            {t.pricing.title}
                        </h2>
                        <p className="text-sm sm:text-base text-muted-foreground">{t.pricing.subtitle}</p>
                    </div>

                    {/* Free Tier Highlight Teaser Card */}
                    <div className="max-w-xl mx-auto p-8 sm:p-10 rounded-3xl bg-card border border-border hover:border-primary/50 transition-all shadow-sm space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-2xl font-extrabold text-foreground">{t.pricing.free.name}</h3>
                            </div>
                            <div className="text-right">
                                <p className="text-3xl font-extrabold font-mono text-foreground">
                                    {t.pricing.free.price}
                                </p>
                                <p className="text-[11px] text-muted-foreground">{t.pricing.periodMonth}</p>
                            </div>
                        </div>

                        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                            {t.pricing.free.desc}
                        </p>

                        <ul className="space-y-2.5 text-xs text-muted-foreground border-t border-border pt-4">
                            {t.pricing.free.features.map((feature, idx) => (
                                <li key={idx} className="flex items-center gap-2 text-foreground">
                                    <Check className="w-4 h-4 text-emerald-500 shrink-0" weight="bold" />
                                    <span>{feature}</span>
                                </li>
                            ))}
                        </ul>

                        <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                            <Link
                                href={isAuthenticated ? '/dashboard' : '/register'}
                                className="w-full sm:flex-1 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs text-center shadow-xs transition-all"
                            >
                                {t.pricing.free.cta}
                            </Link>
                            <Link
                                href="/pricing"
                                className="w-full sm:flex-1 py-3 rounded-xl bg-card hover:bg-muted text-foreground border border-border font-semibold text-xs text-center shadow-xs transition-all flex items-center justify-center gap-1.5"
                            >
                                <span>{language === 'id' ? 'Bandingkan Semua Paket →' : 'Compare All Plans →'}</span>
                            </Link>
                        </div>
                    </div>
                </Container>
            </section>
        </div>
    );
}
