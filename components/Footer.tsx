'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { WhatsappLogo, ShieldCheck, GithubLogo } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { LanguageDropdown } from '@/components/LanguageDropdown';

export function Footer() {
    const { t } = useTranslation();
    const salesNumber = (process.env.NEXT_PUBLIC_SALES_NUMBER || '628123456789').replace(/\D/g, '');

    return (
        <footer className="border-t border-border bg-card/60 backdrop-blur-xs mt-auto">
            <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    {/* Brand & Mission */}
                    <div className="space-y-4 md:col-span-1">
                        <div className="flex items-center gap-2.5">
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
                        <p className="text-xs text-muted-foreground leading-relaxed">{t.footer.description}</p>
                        <div className="flex items-center gap-2 pt-1">
                            <a
                                href={`https://wa.me/${salesNumber}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-semibold border border-emerald-500/20 transition-colors"
                                aria-label="WhatsApp Sales"
                            >
                                <WhatsappLogo className="w-4 h-4" weight="fill" />
                                <span>{t.footer.salesBtn}</span>
                            </a>
                            <a
                                href="https://github.com/razaelmahasaputra/cosmos"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 rounded-xl bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                aria-label="GitHub Repository"
                            >
                                <GithubLogo className="w-4 h-4" weight="fill" />
                            </a>
                        </div>
                    </div>

                    {/* Col 1: Product Navigation */}
                    <div className="space-y-3">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                            {t.footer.navHeading}
                        </h2>
                        <ul className="space-y-2 text-xs text-muted-foreground">
                            <li>
                                <Link href="/" className="hover:text-foreground transition-colors">
                                    {t.nav.home}
                                </Link>
                            </li>
                            <li>
                                <Link href="/how-it-works" className="hover:text-foreground transition-colors">
                                    {t.nav.howItWorks}
                                </Link>
                            </li>
                            <li>
                                <Link href="/pricing" className="hover:text-foreground transition-colors">
                                    {t.nav.pricing}
                                </Link>
                            </li>
                            <li>
                                <Link href="/status" className="hover:text-foreground transition-colors">
                                    {t.nav.status}
                                </Link>
                            </li>
                            <li>
                                <Link href="/dashboard" className="hover:text-foreground transition-colors">
                                    {t.nav.dashboard}
                                </Link>
                            </li>
                        </ul>
                    </div>

                    {/* Col 2: Security & Account */}
                    <div className="space-y-3">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                            {t.footer.securityHeading}
                        </h2>
                        <ul className="space-y-2 text-xs text-muted-foreground">
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
                        </ul>
                    </div>

                    {/* Col 3: Trust & Status */}
                    <div className="space-y-3">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                            {t.footer.trustHeading}
                        </h2>
                        <div className="space-y-3">
                            <Link
                                href="/status"
                                className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                            >
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                                    {t.footer.statusText} →
                                </span>
                            </Link>
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary text-[11px] font-mono text-muted-foreground border border-border">
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                                <span>Cloudflare Ingress & DDOS Guard</span>
                            </div>
                            <div>
                                <LanguageDropdown variant="footer" side="top" align="start" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom bar */}
                <div className="mt-8 pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
                    <p>
                        © {new Date().getFullYear()} Cosmos. {t.footer.rights}
                    </p>
                    <p className="text-[11px] text-muted-foreground/80">
                        Engineered by RazaelFox • Multi-Device WhatsApp Ecosystem
                    </p>
                </div>
            </div>
        </footer>
    );
}
