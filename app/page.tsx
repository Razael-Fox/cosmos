'use client';

import React, { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, WhatsappLogo, CheckCircle, Sparkle, Check } from '@phosphor-icons/react';
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

    const salesNumber = (process.env.NEXT_PUBLIC_SALES_NUMBER || '628123456789').replace(/\D/g, '');

    return (
        <div className="flex flex-col w-full">
            {/* Centered Hero Section */}
            <section className="relative overflow-hidden pt-16 pb-20 md:py-28 border-b border-border cosmos-grid cosmos-glow">
                <Container size="lg">
                    <div className="max-w-3xl mx-auto flex flex-col items-center text-center space-y-6">
                        {/* Eyebrow badge & Live Status indicator pill */}
                        <div className="flex flex-wrap items-center justify-center gap-2.5">
                            <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-semibold tracking-wide">
                                <ShieldCheck className="w-4 h-4" weight="bold" />
                                <span>{t.hero.eyebrow}</span>
                            </div>
                            <Link
                                href="/status"
                                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 text-xs font-semibold tracking-wide transition-colors"
                            >
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                <span>
                                    {t.footer.statusText} • {language === 'id' ? 'Lihat Status' : 'View Status'} →
                                </span>
                            </Link>
                        </div>

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
                        <span className="text-xs font-bold uppercase tracking-wider text-primary font-mono">
                            Free & Scalable
                        </span>
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

            {/* Restyled High-Contrast CTA Banner */}
            <section className="py-20">
                <Container size="lg">
                    <div className="relative rounded-3xl border border-emerald-500/30 dark:border-emerald-400/25 bg-gradient-to-br from-card via-card to-emerald-950/30 dark:from-[#0d1713] dark:via-[#101c17] dark:to-[#08120e] p-8 sm:p-12 flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl shadow-emerald-950/40 dark:shadow-emerald-950/60 overflow-hidden cosmos-grid">
                        {/* Ambient radial glow positioned behind the card content */}
                        <div className="absolute -top-24 -right-24 w-96 h-96 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
                        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

                        <div className="relative z-10 space-y-3 text-center md:text-left max-w-xl">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/15 text-primary dark:text-emerald-400 border border-primary/25 text-xs font-semibold backdrop-blur-xs">
                                <Sparkle className="w-3.5 h-3.5" weight="fill" />
                                <span>Instant Autonomous Setup</span>
                            </div>
                            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold font-heading text-foreground">
                                {t.hero.ctaTitle}
                            </h2>
                            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{t.hero.ctaDesc}</p>
                            <div className="flex flex-wrap gap-3 pt-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1 text-foreground font-medium">
                                    <Check className="w-3.5 h-3.5 text-primary" weight="bold" /> Free 2 Sub-Bots
                                </span>
                                <span className="flex items-center gap-1 text-foreground font-medium">
                                    <Check className="w-3.5 h-3.5 text-primary" weight="bold" /> Zero Ban Risk
                                </span>
                                <span className="flex items-center gap-1 text-foreground font-medium">
                                    <Check className="w-3.5 h-3.5 text-primary" weight="bold" /> WhatsApp Support
                                </span>
                            </div>
                        </div>

                        <div className="relative z-10 flex flex-col sm:flex-row items-center gap-3 shrink-0">
                            {/* CTAs with crisp contrast */}
                            <Link
                                href={isAuthenticated ? '/dashboard' : '/register'}
                                className="px-7 py-3.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm shadow-md transition-all text-center"
                            >
                                {isAuthenticated ? t.nav.dashboard : t.hero.ctaRegister}
                            </Link>
                            <a
                                href={`https://wa.me/${salesNumber}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-5 py-3.5 rounded-xl bg-card hover:bg-muted text-foreground font-semibold text-xs border border-border shadow-xs transition-all flex items-center gap-2"
                            >
                                <WhatsappLogo className="w-4 h-4 text-emerald-500" weight="fill" />
                                <span>Sales WhatsApp</span>
                            </a>
                        </div>
                    </div>
                </Container>
            </section>
        </div>
    );
}
