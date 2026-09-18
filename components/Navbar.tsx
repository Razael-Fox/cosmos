'use client';

import React, { useState, useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { Globe, SignOut, List, X, DeviceMobile } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { clearStoredToken } from '@/lib/api';

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

export function Navbar() {
    const { t, language, setLanguage } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const isAuthenticated = useSyncExternalStore(subscribeToAuth, getAuthSnapshot, getAuthServerSnapshot);

    // Close mobile drawer on escape
    useEffect(() => {
        if (!mobileMenuOpen) return;
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMobileMenuOpen(false);
        };
        window.addEventListener('keydown', handleEscape);
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = '';
        };
    }, [mobileMenuOpen]);

    const handleLogout = () => {
        clearStoredToken();
        router.push('/login');
    };

    const toggleLanguage = () => {
        setLanguage(language === 'id' ? 'en' : 'id');
    };

    const navLinks = [
        { name: t.nav.home, href: '/' },
        { name: t.nav.howItWorks, href: '/#how-it-works' },
        { name: t.nav.pricing, href: '/pricing' },
        ...(isAuthenticated ? [{ name: t.nav.dashboard, href: '/dashboard' }] : [])
    ];

    return (
        <header className="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur-md transition-colors">
            <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
                {/* Brand */}
                <Link href="/" className="flex items-center gap-2.5 group">
                    <Image
                        src="/logo.png"
                        alt="Cosmos Logo"
                        width={34}
                        height={34}
                        className="w-8.5 h-8.5 object-contain group-hover:scale-105 transition-transform"
                        priority
                    />
                    <div className="flex flex-col">
                        <span className="font-heading font-extrabold text-lg tracking-tight text-foreground">
                            {t.nav.brand}
                        </span>
                        <span className="text-[10px] -mt-1 text-muted-foreground font-mono hidden sm:inline-block">
                            {t.nav.portalBadge}
                        </span>
                    </div>
                </Link>

                {/* Desktop Navigation with Active Pill */}
                <nav
                    aria-label="Primary"
                    className="hidden md:flex items-center gap-1 bg-muted/50 p-1 rounded-full border border-border"
                >
                    {navLinks.map((link) => {
                        const isActive = pathname === link.href;
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                aria-current={isActive ? 'page' : undefined}
                                className={`relative px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                                    isActive
                                        ? 'bg-card text-foreground shadow-xs'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                                }`}
                            >
                                {link.name}
                            </Link>
                        );
                    })}
                </nav>

                {/* Right Action Buttons */}
                <div className="hidden md:flex items-center gap-3">
                    {/* Language Toggle */}
                    <button
                        type="button"
                        onClick={toggleLanguage}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                        title="Ganti Bahasa / Switch Language"
                        aria-label="Ganti Bahasa / Switch Language"
                    >
                        <Globe className="w-3.5 h-3.5" />
                        <span className="font-mono">{language.toUpperCase()}</span>
                    </button>

                    {isAuthenticated ? (
                        <div className="flex items-center gap-2">
                            <Link
                                href="/dashboard"
                                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5"
                            >
                                <DeviceMobile className="w-3.5 h-3.5" />
                                <span>{t.nav.dashboard}</span>
                            </Link>
                            <button
                                type="button"
                                onClick={handleLogout}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                            >
                                <SignOut className="w-4 h-4" />
                                <span>{t.nav.logout}</span>
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Link
                                href="/login"
                                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                            >
                                {t.nav.login}
                            </Link>
                            <Link
                                href="/register"
                                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-all"
                            >
                                {t.nav.register}
                            </Link>
                        </div>
                    )}
                </div>

                {/* Mobile Hamburger */}
                <div className="flex items-center gap-2 md:hidden">
                    <button
                        type="button"
                        onClick={toggleLanguage}
                        className="px-2 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground"
                        aria-label="Ganti Bahasa / Switch Language"
                    >
                        {language.toUpperCase()}
                    </button>
                    <button
                        type="button"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="p-2 text-muted-foreground hover:text-foreground rounded-lg"
                        aria-label="Toggle Menu"
                        aria-expanded={mobileMenuOpen}
                        aria-controls="mobile-nav-drawer"
                    >
                        {mobileMenuOpen ? <X className="w-6 h-6" /> : <List className="w-6 h-6" />}
                    </button>
                </div>
            </div>

            {/* Mobile Drawer Overlay */}
            {mobileMenuOpen && (
                <div
                    id="mobile-nav-drawer"
                    role="dialog"
                    aria-modal="true"
                    className="fixed inset-0 top-16 z-50 bg-background/95 backdrop-blur-md md:hidden p-6 flex flex-col justify-between border-t border-border animate-in fade-in slide-in-from-top-4 duration-200"
                >
                    <div className="space-y-4">
                        <div className="flex flex-col gap-1">
                            {navLinks.map((link) => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => setMobileMenuOpen(false)}
                                    className={`py-3 px-4 rounded-xl text-sm font-semibold transition-colors ${
                                        pathname === link.href
                                            ? 'bg-primary/10 text-primary'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                    }`}
                                >
                                    {link.name}
                                </Link>
                            ))}
                        </div>
                    </div>

                    <div className="pt-6 border-t border-border flex flex-col gap-3">
                        {isAuthenticated ? (
                            <>
                                <Link
                                    href="/dashboard"
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="w-full text-center py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-xs"
                                >
                                    {t.nav.dashboard}
                                </Link>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMobileMenuOpen(false);
                                        handleLogout();
                                    }}
                                    className="w-full text-center py-2.5 text-xs font-semibold text-destructive hover:bg-destructive/10 rounded-xl transition-colors"
                                >
                                    {t.nav.logout}
                                </button>
                            </>
                        ) : (
                            <>
                                <Link
                                    href="/login"
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="w-full text-center py-3 rounded-xl border border-border text-foreground text-sm font-semibold hover:bg-muted transition-colors"
                                >
                                    {t.nav.login}
                                </Link>
                                <Link
                                    href="/register"
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="w-full text-center py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-xs"
                                >
                                    {t.nav.register}
                                </Link>
                            </>
                        )}
                    </div>
                </div>
            )}
        </header>
    );
}
