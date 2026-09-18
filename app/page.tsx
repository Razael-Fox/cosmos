'use client';

import React, { useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
    ArrowRight,
    ShieldCheck,
    WhatsappLogo,
    DeviceMobile,
    UsersThree,
    Cpu,
    LockKeyOpen,
    CheckCircle,
    QrCode,
    ChatCircleText,
    Sparkle,
    Check
} from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { Pricing } from '@/components/Pricing';
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
    const { t } = useTranslation();

    const isAuthenticated = useSyncExternalStore(subscribeToAuth, getAuthSnapshot, getAuthServerSnapshot);

    const salesNumber = (process.env.NEXT_PUBLIC_SALES_NUMBER || '628123456789').replace(/\D/g, '');

    return (
        <div className="flex flex-col w-full">
            {/* Hero Section */}
            <section className="relative overflow-hidden pt-12 pb-20 md:py-24 border-b border-border cosmos-grid cosmos-glow">
                <Container size="lg">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
                        {/* Left Column: Copy & CTAs */}
                        <div className="lg:col-span-7 flex flex-col items-center lg:items-start text-center lg:text-left space-y-6">
                            {/* Eyebrow badge */}
                            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-semibold tracking-wide">
                                <ShieldCheck className="w-4 h-4" weight="bold" />
                                <span>{t.hero.eyebrow}</span>
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
                            <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto pt-2">
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

                                <a
                                    href="#how-it-works"
                                    className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-card hover:bg-muted text-foreground font-semibold text-sm border border-border shadow-xs transition-all flex items-center justify-center gap-2"
                                >
                                    <span>{t.hero.ctaHowItWorks}</span>
                                </a>
                            </div>

                            {/* Trust Row */}
                            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 pt-4 text-xs text-muted-foreground">
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

                        {/* Right Column: Product Proof Visual Mock */}
                        <div className="lg:col-span-5 relative w-full flex flex-col gap-4 max-w-lg mx-auto lg:max-w-none">
                            {/* Dashboard Preview Card */}
                            <div className="rounded-2xl border border-border bg-card p-5 shadow-xl space-y-4 backdrop-blur-xs">
                                <div className="flex items-center justify-between border-b border-border pb-3">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-xs font-bold font-mono text-foreground">
                                            COSMOS PORTAL
                                        </span>
                                    </div>
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">
                                        Live Engine
                                    </span>
                                </div>

                                {/* Quota bars */}
                                <div className="space-y-3">
                                    <div className="space-y-1">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-muted-foreground flex items-center gap-1.5">
                                                <DeviceMobile className="w-3.5 h-3.5 text-primary" />
                                                Sub-Bots (1 / 2 Active)
                                            </span>
                                            <span className="font-mono font-bold text-foreground">50%</span>
                                        </div>
                                        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                            <div className="w-1/2 h-full bg-primary rounded-full" />
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-muted-foreground flex items-center gap-1.5">
                                                <UsersThree className="w-3.5 h-3.5 text-indigo-500" />
                                                Whitelisted Groups (2 / 5)
                                            </span>
                                            <span className="font-mono font-bold text-foreground">40%</span>
                                        </div>
                                        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                                            <div className="w-2/5 h-full bg-indigo-500 rounded-full" />
                                        </div>
                                    </div>
                                </div>

                                {/* Pairing Code Card Teaser */}
                                <div className="p-3 rounded-xl bg-muted/50 border border-border flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                                            <QrCode className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-foreground">Pairing Code</p>
                                            <p className="text-[10px] text-muted-foreground font-mono">
                                                CODE: 8249-1194
                                            </p>
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-card border border-border text-primary font-bold">
                                        READY
                                    </span>
                                </div>
                            </div>

                            {/* WhatsApp Verification Chat Mock Bubble */}
                            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 dark:bg-emerald-950/40 p-4 shadow-lg space-y-2.5 backdrop-blur-xs">
                                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                    <WhatsappLogo className="w-4 h-4" weight="fill" />
                                    <span>Inverted Verification WhatsApp Chat</span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-card border border-border text-xs space-y-1">
                                    <p className="text-[11px] text-muted-foreground font-medium">
                                        You sent to Cosmos Bot:
                                    </p>
                                    <code className="text-xs font-mono font-bold text-primary select-all">
                                        .verify COSMOS-948210-4821
                                    </code>
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-emerald-700 dark:text-emerald-300">
                                    <span>✓ Verified in 1.2s</span>
                                    <span className="font-semibold">Zero Spam-Ban Risk</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Container>
            </section>

            {/* How It Works Section */}
            <section id="how-it-works" className="py-20 border-b border-border bg-muted/20">
                <Container size="lg" className="space-y-12">
                    <div className="text-center max-w-2xl mx-auto space-y-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-primary">3 Simple Steps</span>
                        <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground font-heading">
                            {t.howItWorks.title}
                        </h2>
                        <p className="text-sm sm:text-base text-muted-foreground">{t.howItWorks.subtitle}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Step 1 */}
                        <div className="p-6 sm:p-8 rounded-2xl bg-card border border-border shadow-xs space-y-3 hover:border-primary/50 transition-colors">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary font-bold flex items-center justify-center font-mono">
                                1
                            </div>
                            <h3 className="text-lg font-bold text-foreground">{t.howItWorks.step1Title}</h3>
                            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                                {t.howItWorks.step1Desc}
                            </p>
                        </div>

                        {/* Step 2 */}
                        <div className="p-6 sm:p-8 rounded-2xl bg-card border border-border shadow-xs space-y-3 hover:border-primary/50 transition-colors">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary font-bold flex items-center justify-center font-mono">
                                2
                            </div>
                            <h3 className="text-lg font-bold text-foreground">{t.howItWorks.step2Title}</h3>
                            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                                {t.howItWorks.step2Desc}
                            </p>
                        </div>

                        {/* Step 3 */}
                        <div className="p-6 sm:p-8 rounded-2xl bg-card border border-border shadow-xs space-y-3 hover:border-primary/50 transition-colors">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary font-bold flex items-center justify-center font-mono">
                                3
                            </div>
                            <h3 className="text-lg font-bold text-foreground">{t.howItWorks.step3Title}</h3>
                            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                                {t.howItWorks.step3Desc}
                            </p>
                        </div>
                    </div>
                </Container>
            </section>

            {/* Feature Deep Dive (Restyled 4 Cards) */}
            <section className="py-20 border-b border-border">
                <Container size="lg" className="space-y-14">
                    <div className="text-center max-w-2xl mx-auto space-y-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-primary">
                            Core Architecture
                        </span>
                        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground font-heading">
                            {t.features.title}
                        </h2>
                        <p className="text-base text-muted-foreground">{t.features.subtitle}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                        {/* Card 1 */}
                        <div className="p-8 rounded-3xl bg-card border border-border space-y-4 hover:border-primary/50 transition-colors shadow-xs">
                            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                                <Cpu className="w-6 h-6" weight="duotone" />
                            </div>
                            <h3 className="text-xl font-bold text-foreground">{t.features.subbots.title}</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">{t.features.subbots.desc}</p>
                            <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle className="w-4 h-4" weight="fill" />
                                <span>{t.features.subbots.badge}</span>
                            </div>
                        </div>

                        {/* Card 2 */}
                        <div className="p-8 rounded-3xl bg-card border border-border space-y-4 hover:border-primary/50 transition-colors shadow-xs">
                            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                                <LockKeyOpen className="w-6 h-6" weight="duotone" />
                            </div>
                            <h3 className="text-xl font-bold text-foreground">{t.features.security.title}</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">{t.features.security.desc}</p>
                            <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle className="w-4 h-4" weight="fill" />
                                <span>{t.features.security.badge}</span>
                            </div>
                        </div>

                        {/* Card 3 */}
                        <div className="p-8 rounded-3xl bg-card border border-border space-y-4 hover:border-primary/50 transition-colors shadow-xs">
                            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                                <UsersThree className="w-6 h-6" weight="duotone" />
                            </div>
                            <h3 className="text-xl font-bold text-foreground">{t.features.whitelist.title}</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">{t.features.whitelist.desc}</p>
                            <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle className="w-4 h-4" weight="fill" />
                                <span>{t.features.whitelist.badge}</span>
                            </div>
                        </div>

                        {/* Card 4 */}
                        <div className="p-8 rounded-3xl bg-card border border-border space-y-4 hover:border-primary/50 transition-colors shadow-xs">
                            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                                <ChatCircleText className="w-6 h-6" weight="duotone" />
                            </div>
                            <h3 className="text-xl font-bold text-foreground">{t.features.economy.title}</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">{t.features.economy.desc}</p>
                            <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle className="w-4 h-4" weight="fill" />
                                <span>{t.features.economy.badge}</span>
                            </div>
                        </div>
                    </div>
                </Container>
            </section>

            {/* Social Proof & Metrics */}
            <section className="py-16 border-b border-border bg-card/40">
                <Container size="lg">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
                        <div className="p-4 space-y-1">
                            <p className="text-3xl sm:text-4xl font-extrabold font-mono text-primary">100+</p>
                            <p className="text-xs text-muted-foreground font-medium">Sub-Bots Connected</p>
                        </div>
                        <div className="p-4 space-y-1">
                            <p className="text-3xl sm:text-4xl font-extrabold font-mono text-primary">99.9%</p>
                            <p className="text-xs text-muted-foreground font-medium">System Uptime</p>
                        </div>
                        <div className="p-4 space-y-1">
                            <p className="text-3xl sm:text-4xl font-extrabold font-mono text-primary">500+</p>
                            <p className="text-xs text-muted-foreground font-medium">Whitelisted Groups</p>
                        </div>
                        <div className="p-4 space-y-1">
                            <p className="text-3xl sm:text-4xl font-extrabold font-mono text-primary">0</p>
                            <p className="text-xs text-muted-foreground font-medium">Spam-Ban Incidence</p>
                        </div>
                    </div>
                </Container>
            </section>

            {/* Embedded Pricing Section */}
            <section id="pricing" className="border-b border-border bg-muted/10">
                <Pricing />
                <div className="text-center pb-12">
                    <Link
                        href="/pricing"
                        className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline"
                    >
                        <span>Compare all features and view FAQs →</span>
                    </Link>
                </div>
            </section>

            {/* Final CTA Banner */}
            <section className="py-16">
                <Container size="lg">
                    <div className="rounded-3xl bg-gradient-to-br from-primary to-emerald-800 text-white p-8 sm:p-12 flex flex-col md:flex-row items-center justify-between gap-8 shadow-xl cosmos-grid">
                        <div className="space-y-3 text-center md:text-left max-w-xl">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-white text-xs font-semibold backdrop-blur-xs">
                                <Sparkle className="w-3.5 h-3.5" weight="fill" />
                                <span>Instant Autonomous Setup</span>
                            </div>
                            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold font-heading">
                                {t.hero.ctaTitle}
                            </h2>
                            <p className="text-xs sm:text-sm text-white/85 leading-relaxed">{t.hero.ctaDesc}</p>
                            <div className="flex flex-wrap gap-3 pt-2 text-xs text-white/90">
                                <span className="flex items-center gap-1">
                                    <Check className="w-3.5 h-3.5" weight="bold" /> Free 2 Sub-Bots
                                </span>
                                <span className="flex items-center gap-1">
                                    <Check className="w-3.5 h-3.5" weight="bold" /> Zero Ban Risk
                                </span>
                                <span className="flex items-center gap-1">
                                    <Check className="w-3.5 h-3.5" weight="bold" /> WhatsApp Support
                                </span>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0">
                            {isAuthenticated ? (
                                <Link
                                    href="/dashboard"
                                    className="px-7 py-3.5 rounded-xl bg-white text-emerald-900 hover:bg-white/90 font-bold text-sm shadow-md transition-all text-center"
                                >
                                    {t.nav.dashboard}
                                </Link>
                            ) : (
                                <Link
                                    href="/register"
                                    className="px-7 py-3.5 rounded-xl bg-white text-emerald-900 hover:bg-white/90 font-bold text-sm shadow-md transition-all text-center"
                                >
                                    {t.hero.ctaRegister}
                                </Link>
                            )}
                            <a
                                href={`https://wa.me/${salesNumber}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-5 py-3.5 rounded-xl bg-emerald-900/60 hover:bg-emerald-900/80 text-white font-semibold text-xs border border-white/20 transition-all flex items-center gap-2"
                            >
                                <WhatsappLogo className="w-4 h-4" weight="fill" />
                                <span>Sales WhatsApp</span>
                            </a>
                        </div>
                    </div>
                </Container>
            </section>
        </div>
    );
}
