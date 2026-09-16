'use client';

import React from 'react';
import { Check, WhatsappLogo, Sparkle, Lightning, ShieldCheck } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import type { SubscriptionTier } from '@/lib/types';

interface PricingProps {
  userPhone?: string;
  currentTier?: SubscriptionTier;
  onSelectFree?: () => void;
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
  const targetPhone = userPhone || '[Nomor WhatsApp Anda]';

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

  const handleSubscribe = (tierName: string, price: string) => {
    const url = generateSalesUrl(tierName, price, userPhone, t.sales.prefillMsg, salesNumber);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const plans = [
    {
      id: 'FREE' as SubscriptionTier,
      name: t.pricing.free.name,
      badge: t.pricing.free.badge,
      price: t.pricing.free.price,
      desc: t.pricing.free.desc,
      features: t.pricing.free.features,
      isPopular: false,
      icon: <Sparkle className="w-6 h-6 text-zinc-500" />,
      ctaText: t.pricing.free.cta,
      action: onSelectFree ? onSelectFree : undefined,
      href: onSelectFree ? undefined : '/register',
    },
    {
      id: 'SUBSIDIZED' as SubscriptionTier,
      name: t.pricing.subsidized.name,
      badge: t.pricing.subsidized.badge,
      price: t.pricing.subsidized.price,
      desc: t.pricing.subsidized.desc,
      features: t.pricing.subsidized.features,
      isPopular: true,
      icon: <Lightning className="w-6 h-6 text-amber-500" weight="fill" />,
      ctaText: t.pricing.subsidized.cta,
      action: () => handleSubscribe('Subsidized Tier', t.pricing.subsidized.price),
    },
    {
      id: 'PARTNER' as SubscriptionTier,
      name: t.pricing.partner.name,
      badge: t.pricing.partner.badge,
      price: t.pricing.partner.price,
      desc: t.pricing.partner.desc,
      features: t.pricing.partner.features,
      isPopular: false,
      icon: <ShieldCheck className="w-6 h-6 text-indigo-500" weight="fill" />,
      ctaText: t.pricing.partner.cta,
      action: () => handleSubscribe('Partner Tier', t.pricing.partner.price),
    },
  ];

  return (
    <div className="w-full py-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto flex flex-col gap-10">
      <div className="text-center max-w-3xl mx-auto space-y-3">
        <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-foreground font-heading">
          {t.pricing.title}
        </h2>
        <p className="text-base md:text-lg text-muted-foreground">
          {t.pricing.subtitle}
        </p>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-xs text-muted-foreground border border-border">
          <WhatsappLogo className="w-4 h-4 text-emerald-600" weight="fill" />
          <span>{t.pricing.manualFlowNotice}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
        {plans.map((plan) => {
          const isCurrent = currentTier === plan.id;
          return (
            <div
              key={plan.id}
              className={`rounded-3xl p-8 flex flex-col justify-between transition-all relative ${
                plan.isPopular
                  ? 'bg-card border-2 border-primary shadow-xl scale-[1.02]'
                  : 'bg-card border border-border shadow-sm hover:shadow-md'
              }`}
            >
              {plan.isPopular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider shadow-sm">
                  {t.pricing.popular}
                </div>
              )}

              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="p-2.5 rounded-2xl bg-muted border border-border">
                    {plan.icon}
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground">
                    {plan.badge}
                  </span>
                </div>

                <div>
                  <h3 className="text-2xl font-bold text-foreground">{plan.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1 min-h-[32px]">{plan.desc}</p>
                </div>

                <div className="flex items-baseline gap-1 pt-2 border-t border-border">
                  <span className="text-4xl font-extrabold tracking-tight text-foreground">
                    {plan.price}
                  </span>
                  <span className="text-sm text-muted-foreground">{t.pricing.periodMonth}</span>
                </div>

                <div className="space-y-3 pt-2">
                  <p className="text-xs font-bold text-foreground uppercase tracking-wider">
                    {t.pricing.included}
                  </p>
                  <ul className="space-y-2.5 text-sm text-muted-foreground">
                    {plan.features.map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" weight="bold" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="pt-8">
                {isCurrent ? (
                  <div className="w-full py-3 px-4 rounded-xl bg-muted text-center text-sm font-semibold text-muted-foreground border border-border">
                    Paket Aktif Anda
                  </div>
                ) : plan.href ? (
                  <a
                    href={plan.href}
                    className={`w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-semibold text-sm transition-all shadow-sm ${
                      plan.isPopular
                        ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
                        : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border'
                    }`}
                  >
                    <span>{plan.ctaText}</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={plan.action}
                    className={`w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-semibold text-sm transition-all shadow-sm ${
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
