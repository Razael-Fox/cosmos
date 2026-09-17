'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { WhatsappLogo, ShieldCheck, GithubLogo } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';

export function Footer() {
  const { t } = useTranslation();
  const salesNumber = (process.env.NEXT_PUBLIC_SALES_NUMBER || '628123456789').replace(/\D/g, '');

  return (
    <footer className="border-t border-border bg-card mt-auto">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-3 md:col-span-2">
            <div className="flex items-center gap-2">
              <Image
                src="/logo.png"
                alt="Cosmos Logo"
                width={32}
                height={32}
                className="w-8 h-8 object-contain"
              />
              <span className="font-heading font-extrabold text-lg tracking-tight text-foreground">
                {t.nav.brand}
              </span>
            </div>
            <p className="text-xs text-muted-foreground max-w-sm">
              {t.nav.tagline}. {t.footer.description}
            </p>
            <div className="flex items-center gap-3 pt-2">
              <a
                href={`https://wa.me/${salesNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg bg-muted text-muted-foreground hover:text-emerald-600 transition-colors"
                aria-label="WhatsApp Sales"
              >
                <WhatsappLogo className="w-5 h-5" weight="fill" />
              </a>
              <a
                href="https://github.com/razaelmahasaputra/cosmos"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="GitHub Repository"
              >
                <GithubLogo className="w-5 h-5" weight="fill" />
              </a>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-[11px] font-mono text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>Cloudflare Protected</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">{t.footer.navHeading}</h2>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>
                <Link href="/" className="hover:text-foreground transition-colors">
                  {t.nav.home}
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-foreground transition-colors">
                  {t.nav.pricing}
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-foreground transition-colors">
                  {t.nav.dashboard}
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">{t.footer.securityHeading}</h2>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>
                <Link href="/register" className="hover:text-foreground transition-colors">
                  {t.nav.register}
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-foreground transition-colors">
                  {t.nav.login}
                </Link>
              </li>
              <li className="text-[11px] text-muted-foreground/80">
                {t.footer.noteAntiSpam}
              </li>
              <li className="text-[11px] text-muted-foreground/80">
                {t.footer.noteVps}
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} Cosmos Ecosystem. {t.footer.rights}</p>
          <p className="font-mono text-[11px]">{t.footer.branch}</p>
        </div>
      </div>
    </footer>
  );
}
