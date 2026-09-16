'use client';

import React from 'react';
import Link from 'next/link';
import {
  Sparkle,
  ArrowRight,
  ShieldCheck,
  WhatsappLogo,
  DeviceMobile,
  UsersThree,
  Cpu,
  LockKeyOpen,
  CheckCircle,
} from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { Pricing } from '@/components/Pricing';

export default function HomePage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col w-full">
      {/* Hero Section */}
      <section className="relative overflow-hidden py-16 md:py-24 border-b border-border bg-gradient-to-b from-background via-card to-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center text-center gap-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-secondary text-secondary-foreground border border-border text-xs font-semibold shadow-xs animate-in fade-in duration-300">
            <Sparkle className="w-3.5 h-3.5 text-primary" weight="fill" />
            <span>{t.hero.badge}</span>
          </div>

          {/* Title & Subtitle */}
          <div className="max-w-3xl space-y-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-foreground font-heading leading-[1.15]">
              {t.hero.title}
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              {t.hero.subtitle}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            <Link
              href="/register"
              className="w-full sm:w-auto px-7 py-3.5 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2"
            >
              <span>{t.hero.ctaRegister}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/pricing"
              className="w-full sm:w-auto px-7 py-3.5 rounded-2xl bg-secondary hover:bg-secondary/80 text-secondary-foreground font-semibold text-sm border border-border transition-all flex items-center justify-center gap-2"
            >
              <span>{t.hero.ctaPricing}</span>
            </Link>
          </div>

          {/* Feature Highlights Banner */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-5xl mt-8 pt-8 border-t border-border">
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-card border border-border text-left">
              <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0">
                <DeviceMobile className="w-5 h-5" weight="duotone" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-bold text-foreground">{t.hero.feature1Title}</h2>
                <p className="text-xs text-muted-foreground">{t.hero.feature1Desc}</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-2xl bg-card border border-border text-left">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 shrink-0">
                <WhatsappLogo className="w-5 h-5" weight="duotone" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-bold text-foreground">{t.hero.feature2Title}</h2>
                <p className="text-xs text-muted-foreground">{t.hero.feature2Desc}</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-2xl bg-card border border-border text-left">
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 shrink-0">
                <UsersThree className="w-5 h-5" weight="duotone" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-bold text-foreground">{t.hero.feature3Title}</h2>
                <p className="text-xs text-muted-foreground">{t.hero.feature3Desc}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Deep Dive */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full space-y-16">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground font-heading">
            {t.features.title}
          </h2>
          <p className="text-base text-muted-foreground">
            {t.features.subtitle}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Card 1 */}
          <div className="p-8 rounded-3xl bg-card border border-border space-y-4 hover:border-primary/50 transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <Cpu className="w-6 h-6" weight="duotone" />
            </div>
            <h3 className="text-xl font-bold text-foreground">
              {t.features.subbots.title}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t.features.subbots.desc}
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="w-4 h-4" weight="fill" />
              <span>Multi-device Baileys v6 Lifecycle & Pool Isolation</span>
            </div>
          </div>

          {/* Card 2 */}
          <div className="p-8 rounded-3xl bg-card border border-border space-y-4 hover:border-primary/50 transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <LockKeyOpen className="w-6 h-6" weight="duotone" />
            </div>
            <h3 className="text-xl font-bold text-foreground">
              {t.features.security.title}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t.features.security.desc}
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="w-4 h-4" weight="fill" />
              <span>Cloudflare Ingress & Outbound Tunnel (LXC NAT VPS)</span>
            </div>
          </div>

          {/* Card 3 */}
          <div className="p-8 rounded-3xl bg-card border border-border space-y-4 hover:border-primary/50 transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
              <UsersThree className="w-6 h-6" weight="duotone" />
            </div>
            <h3 className="text-xl font-bold text-foreground">
              {t.features.whitelist.title}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t.features.whitelist.desc}
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="w-4 h-4" weight="fill" />
              <span>Strict Quota Enforcement & Zero IDOR Exposure</span>
            </div>
          </div>

          {/* Card 4 */}
          <div className="p-8 rounded-3xl bg-card border border-border space-y-4 hover:border-primary/50 transition-colors">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" weight="duotone" />
            </div>
            <h3 className="text-xl font-bold text-foreground">
              {t.features.economy.title}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t.features.economy.desc}
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="w-4 h-4" weight="fill" />
              <span>Double-Entry ACID Accounting & Credit Engine</span>
            </div>
          </div>
        </div>
      </section>

      {/* Embedded Pricing Section */}
      <section className="border-t border-border bg-muted/20">
        <Pricing />
      </section>

      {/* Final CTA Banner */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        <div className="rounded-3xl bg-primary text-primary-foreground p-8 sm:p-12 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
          <div className="space-y-2 text-center md:text-left">
            <h2 className="text-2xl sm:text-3xl font-bold font-heading">
              Siap Menjalankan Bot WhatsApp Anda?
            </h2>
            <p className="text-sm text-primary-foreground/80 max-w-md">
              Daftarkan nomor WhatsApp sekarang melalui verifikasi aman bebas banned, dan mulai tautkan sub-bot dalam hitungan menit.
            </p>
          </div>
          <Link
            href="/register"
            className="px-8 py-3.5 rounded-2xl bg-background text-foreground hover:bg-background/90 font-bold text-sm shadow-md transition-all shrink-0"
          >
            {t.hero.ctaRegister}
          </Link>
        </div>
      </section>
    </div>
  );
}
