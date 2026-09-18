'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ShieldCheck, WhatsappLogo, CheckCircle, Lock } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';

interface AuthShellProps {
  currentStep?: 1 | 2 | 3;
  children: React.ReactNode;
}

export function AuthShell({ currentStep = 1, children }: AuthShellProps) {
  const { t } = useTranslation();

  return (
    <div className="flex-1 w-full min-h-[calc(100vh-4rem)] flex items-stretch">
      {/* Left Brand Panel (Desktop only) */}
      <div className="hidden lg:flex lg:w-5/12 bg-gradient-to-br from-emerald-950 via-zinc-950 to-black text-white p-12 flex-col justify-between relative border-r border-border cosmos-grid cosmos-glow">
        <div className="space-y-8 relative z-10">
          {/* Logo & Brand */}
          <Link href="/" className="flex items-center gap-3 group">
            <Image
              src="/logo.png"
              alt="Cosmos Logo"
              width={40}
              height={40}
              className="w-10 h-10 object-contain group-hover:scale-105 transition-transform"
              priority
            />
            <div className="flex flex-col">
              <span className="font-heading font-extrabold text-xl tracking-tight text-white">
                Cosmos
              </span>
              <span className="text-[11px] text-emerald-400 font-mono">
                Multi-Device WhatsApp Portal
              </span>
            </div>
          </Link>

          {/* Stepper Progress */}
          <div className="space-y-4 pt-6 border-t border-white/10">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Registration Progress
            </p>
            <div className="space-y-3 text-xs">
              <div
                className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                  currentStep >= 1
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-white font-medium'
                    : 'bg-white/5 border-white/10 text-white/50'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                    currentStep > 1
                      ? 'bg-emerald-500 text-black'
                      : currentStep === 1
                      ? 'bg-emerald-400 text-black'
                      : 'bg-white/10 text-white/40'
                  }`}
                >
                  {currentStep > 1 ? '✓' : '1'}
                </div>
                <span>{t.auth.step1Label}</span>
              </div>

              <div
                className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                  currentStep >= 2
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-white font-medium'
                    : 'bg-white/5 border-white/10 text-white/50'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                    currentStep > 2
                      ? 'bg-emerald-500 text-black'
                      : currentStep === 2
                      ? 'bg-emerald-400 text-black'
                      : 'bg-white/10 text-white/40'
                  }`}
                >
                  {currentStep > 2 ? '✓' : '2'}
                </div>
                <span>{t.auth.step2Label}</span>
              </div>

              <div
                className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                  currentStep === 3
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-white font-medium'
                    : 'bg-white/5 border-white/10 text-white/50'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                    currentStep === 3 ? 'bg-emerald-400 text-black' : 'bg-white/10 text-white/40'
                  }`}
                >
                  3
                </div>
                <span>{t.auth.step3Label}</span>
              </div>
            </div>
          </div>

          {/* Trust points */}
          <div className="space-y-3 pt-6 border-t border-white/10 text-xs text-white/80">
            <div className="flex items-center gap-2.5">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" weight="fill" />
              <span>Official Baileys Multi-Device Web Emulation</span>
            </div>
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" weight="fill" />
              <span>Inbound WhatsApp verification — zero spam-ban risk</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Lock className="w-4 h-4 text-emerald-400 shrink-0" weight="fill" />
              <span>Protected by Cloudflare Turnstile & DDOS Guard</span>
            </div>
          </div>
        </div>

        {/* Bottom preview chat bubble */}
        <div className="relative z-10 p-4 rounded-2xl bg-emerald-900/30 border border-emerald-500/30 backdrop-blur-xs text-xs space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <WhatsappLogo className="w-4 h-4" weight="fill" />
            <span>Organic Inverted Verify</span>
          </div>
          <p className="text-white/70 text-[11px] leading-relaxed">
            WhatsApp recognizes messages originating from you as genuine user chats, protecting your personal number.
          </p>
        </div>
      </div>

      {/* Right Column: Form Area */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 lg:p-12 bg-background">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
