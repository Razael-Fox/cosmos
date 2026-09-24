'use client';

import React, { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Check, WhatsappLogo, Sparkle, Lightning, ShieldCheck } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import type { SubscriptionTier } from '@/lib/types';
import { Container } from '@/components/ui/container';

interface PricingProps {
    userPhone?: string;
    currentTier?: SubscriptionTier;
    onSelectFree?: () => void;
}

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

function generateSalesUrl(
    tierName: string,
    price: string,
    userPhone: string | undefined,
    template: string,
    salesNumber: string
): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const orderRef = `COSMOS-SUB-${timestamp}`;
    const targetPhone = userPhone || '[WhatsApp Phone]';

    const msg = template
        .replace('{tier}', tierName)
        .replace('{price}', price)
        .replace('{phone}', targetPhone)
        .replace('{ref}', orderRef);

    return `https://wa.me/${salesNumber}?text=${encodeURIComponent(msg)}`;
}

export function Pricing({ userPhone, currentTier, onSelectFree }: PricingProps) {
    const { t } = useTranslation();
    const salesNumber = (process.env.NEXT_PUBLIC_SALES_NUMBER || '628123456789').replace(/\D/g, '');

    const isAuthenticated = useSyncExternalStore(subscribeToAuth, getAuthSnapshot, getAuthServerSnapshot);

    const handleSubscribe = (tierName: string, price: string) => {
        const url = generateSalesUrl(tierName, price, userPhone, t.sales.prefillMsg, salesNumber);
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const freeHref = isAuthenticated ? '/dashboard' : '/register';
    const freeCtaText =
        isAuthenticated && currentTier === 'FREE'
            ? t.pricing.activePlan
            : isAuthenticated
              ? t.nav.dashboard
              : t.pricing.free.cta;

    const plans = [
        {
            id: 'FREE' as SubscriptionTier,
            name: t.pricing.free.name,
            price: t.pricing.free.price,
            desc: t.pricing.free.desc,
            features: t.pricing.free.features,
            isPopular: false,
            icon: <Sparkle className="w-5 h-5 text-primary" />,
            ctaText: freeCtaText,
            action: onSelectFree ? onSelectFree : undefined,
            href: onSelectFree ? undefined : freeHref
        },
        {
            id: 'SUBSIDIZED' as SubscriptionTier,
            name: t.pricing.subsidized.name,
            price: t.pricing.subsidized.price,
            desc: t.pricing.subsidized.desc,
            features: t.pricing.subsidized.features,
            isPopular: true,
            icon: <Lightning className="w-5 h-5 text-amber-500" weight="fill" />,
            ctaText: t.pricing.subsidized.cta,
            action: () => handleSubscribe('Nova Plan (Subsidized)', t.pricing.subsidized.price)
        },
        {
            id: 'PARTNER' as SubscriptionTier,
            name: t.pricing.partner.name,
            price: t.pricing.partner.price,
            desc: t.pricing.partner.desc,
            features: t.pricing.partner.features,
            isPopular: false,
            icon: <ShieldCheck className="w-5 h-5 text-indigo-500" weight="fill" />,
            ctaText: t.pricing.partner.cta,
            action: () => handleSubscribe('Zenith Plan (Partner)', t.pricing.partner.price)
        }
    ];

    return (
        <Container size="lg" className="py-16 space-y-12">
            {/* Header */}
            <div className="text-center max-w-3xl mx-auto space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                    Simple, Transparent Pricing
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground font-heading">
                    {t.pricing.title}
                </h2>
                <p className="text-base text-muted-foreground">{t.pricing.subtitle}</p>

                {/* Step-by-step manual sales notice callout */}
                <div className="mt-6 p-4 rounded-2xl bg-card border border-border shadow-xs text-left max-w-2xl mx-auto space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                        <WhatsappLogo className="w-4 h-4 text-emerald-500" weight="fill" />
                        <span>{t.pricing.salesNoticeTitle}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <p>{t.pricing.salesNoticeStep1}</p>
                        <p>{t.pricing.salesNoticeStep2}</p>
                        <p>{t.pricing.salesNoticeStep3}</p>
                        <p>{t.pricing.salesNoticeStep4}</p>
                    </div>
                </div>
            </div>

            {/* Plan Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch pt-4">
                {plans.map((plan) => {
                    const isCurrent = currentTier === plan.id;
                    return (
                        <article
                            key={plan.id}
                            aria-label={`${plan.name} plan`}
                            className={`rounded-3xl p-8 flex flex-col justify-between transition-all relative ${
                                plan.isPopular
                                    ? 'bg-card border-2 border-primary ring-4 ring-primary/10 shadow-xl md:-translate-y-2'
                                    : 'bg-card border border-border shadow-xs hover:border-primary/40'
                            }`}
                        >
                            {plan.isPopular && (
                                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-md bg-primary text-primary-foreground text-[11px] font-bold uppercase tracking-wider shadow-sm">
                                    {t.pricing.popular}
                                </div>
                            )}

                            <div className="space-y-6">
                                <div>
                                    <div className="w-fit p-2.5 rounded-2xl bg-muted border border-border">{plan.icon}</div>
                                </div>

                                <div>
                                    <h3 className="text-2xl font-bold text-foreground font-heading">{plan.name}</h3>
                                    <p className="text-xs text-muted-foreground mt-1 min-h-[36px] leading-relaxed">
                                        {plan.desc}
                                    </p>
                                </div>

                                <div className="flex items-baseline gap-1 pt-3 border-t border-border">
                                    <span className="text-4xl font-extrabold tracking-tight text-foreground font-mono">
                                        {plan.price}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{t.pricing.periodMonth}</span>
                                </div>

                                <div className="space-y-3 pt-2">
                                    <p className="text-xs font-bold text-foreground uppercase tracking-wider">
                                        {t.pricing.included}
                                    </p>
                                    <ul className="space-y-2.5 text-xs text-muted-foreground">
                                        {plan.features.map((feat, idx) => (
                                            <li key={idx} className="flex items-start gap-2.5">
                                                <Check
                                                    className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0"
                                                    weight="bold"
                                                />
                                                <span>{feat}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            <div className="pt-8">
                                {isCurrent ? (
                                    <div
                                        role="status"
                                        className="w-full py-3 px-4 rounded-xl bg-muted text-center text-xs font-semibold text-muted-foreground border border-border"
                                    >
                                        {t.pricing.activePlan}
                                    </div>
                                ) : plan.href ? (
                                    <Link
                                        href={plan.href}
                                        className={`w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-semibold text-xs transition-all shadow-xs ${
                                            plan.isPopular
                                                ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
                                                : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border'
                                        }`}
                                    >
                                        <span>{plan.ctaText}</span>
                                    </Link>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={plan.action}
                                        className={`w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-semibold text-xs transition-all shadow-xs cursor-pointer ${
                                            plan.isPopular
                                                ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
                                                : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border'
                                        }`}
                                    >
                                        <WhatsappLogo className="w-4 h-4" weight="fill" />
                                        <span>{plan.ctaText}</span>
                                    </button>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>
        </Container>
    );
}
