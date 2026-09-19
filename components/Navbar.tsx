'use client';

import React, { useState, useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { SignOut, List, X, DeviceMobile } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { clearStoredToken } from '@/lib/api';
import { LanguageDropdown } from '@/components/LanguageDropdown';

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
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const isAuthenticated = useSyncExternalStore(subscribeToAuth, getAuthSnapshot, getAuthServerSnapshot);

    // Close mobile drawer on escape key and lock body scroll
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

    // Close mobile drawer when resizing up to desktop
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 768 && mobileMenuOpen) {
                setMobileMenuOpen(false);
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [mobileMenuOpen]);

    const handleLogout = () => {
        clearStoredToken();
        router.push('/login');
    };

    const navLinks = [
        { name: t.nav.home, href: '/' },
        { name: t.nav.howItWorks, href: '/how-it-works' },
        { name: t.nav.pricing, href: '/pricing' },
        { name: t.nav.status, href: '/status' },
        ...(isAuthenticated ? [{ name: t.nav.dashboard, href: '/dashboard' }] : [])
    ];

    return (
        <>
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
                        className="hidden md:flex items-center gap-1 bg-muted/50 p-1 rounded-xl border border-border"
                    >
                        {navLinks.map((link) => {
                            const isActive = pathname === link.href;
                            return (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    aria-current={isActive ? 'page' : undefined}
                                    className={`relative px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
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

                    {/* Right Action Buttons (Desktop) */}
                    <div className="hidden md:flex items-center gap-3">
                        {/* Language Dropdown with upward display */}
                        <LanguageDropdown variant="navbar" side="top" align="end" />

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

                    {/* Mobile Header Brand Status (Header right side on mobile) */}
                    <div className="flex items-center gap-2 md:hidden">
                        {isAuthenticated ? (
                            <Link
                                href="/dashboard"
                                className="p-2 rounded-xl bg-primary/10 text-primary text-xs font-semibold flex items-center gap-1"
                                aria-label={t.nav.dashboard}
                            >
                                <DeviceMobile className="w-4 h-4" />
                            </Link>
                        ) : (
                            <Link
                                href="/login"
                                className="px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                            >
                                {t.nav.login}
                            </Link>
                        )}
                    </div>
                </div>
            </header>

            {/* Mobile Bottom Capsule Floating Component (Mobile UI only) */}
            {!mobileMenuOpen && (
                <div className="fixed bottom-5 inset-x-0 z-40 flex justify-center items-center pointer-events-none md:hidden px-4">
                    <div className="pointer-events-auto inline-flex items-center gap-1.5 p-1.5 rounded-full border border-border/80 bg-background/90 backdrop-blur-lg shadow-xl ring-1 ring-foreground/10 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        {/* Drawer Button */}
                        <button
                            type="button"
                            onClick={() => setMobileMenuOpen(true)}
                            className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-all active:scale-95 cursor-pointer touch-manipulation"
                            aria-label="Open Navigation Drawer"
                            aria-expanded={mobileMenuOpen}
                            aria-controls="mobile-nav-drawer"
                        >
                            <List className="w-4 h-4" weight="bold" />
                            <span>Menu</span>
                        </button>

                        {/* Subtle Vertical Divider */}
                        <div className="w-px h-5 bg-border/80 my-auto" />

                        {/* Language Switch Button with Dropdown (Upward display) */}
                        <LanguageDropdown variant="capsule" side="top" align="center" />
                    </div>
                </div>
            )}

            {/* Mobile Navigation Drawer */}
            {mobileMenuOpen && (
                <div
                    id="mobile-nav-drawer"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Mobile Navigation"
                    className="fixed inset-0 z-50 flex flex-col bg-background md:hidden animate-in fade-in duration-200"
                >
                    {/* Drawer Header Bar */}
                    <div className="flex h-16 items-center justify-between px-4 sm:px-6 border-b border-border shrink-0">
                        <Link
                            href="/"
                            onClick={() => setMobileMenuOpen(false)}
                            className="flex items-center gap-2.5"
                        >
                            <Image
                                src="/logo.png"
                                alt="Cosmos Logo"
                                width={32}
                                height={32}
                                className="w-8 h-8 object-contain"
                            />
                            <div className="flex flex-col">
                                <span className="font-heading font-extrabold text-base tracking-tight text-foreground">
                                    {t.nav.brand}
                                </span>
                                <span className="text-[10px] -mt-1 text-muted-foreground font-mono">
                                    {t.nav.portalBadge}
                                </span>
                            </div>
                        </Link>

                        <div className="flex items-center gap-2">
                            <LanguageDropdown variant="navbar" side="top" align="end" />
                            <button
                                type="button"
                                onClick={() => setMobileMenuOpen(false)}
                                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors cursor-pointer touch-manipulation"
                                aria-label="Close Menu"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                    </div>

                    {/* Drawer Nav Links */}
                    <div className="flex-1 overflow-y-auto px-6 py-6">
                        <nav className="flex flex-col gap-1.5">
                            {navLinks.map((link) => {
                                const isActive = pathname === link.href;
                                return (
                                    <Link
                                        key={link.href}
                                        href={link.href}
                                        onClick={() => setMobileMenuOpen(false)}
                                        className={`py-3.5 px-4 rounded-2xl text-base font-semibold transition-all flex items-center justify-between touch-manipulation ${
                                            isActive
                                                ? 'bg-primary/15 text-primary dark:text-emerald-400 font-bold'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                                        }`}
                                    >
                                        <span>{link.name}</span>
                                        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>

                    {/* Drawer Auth Actions */}
                    <div className="p-6 border-t border-border bg-card/40 shrink-0 flex flex-col gap-3">
                        {isAuthenticated ? (
                            <>
                                <Link
                                    href="/dashboard"
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="w-full text-center py-3.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold shadow-xs flex items-center justify-center gap-2 transition-colors touch-manipulation"
                                >
                                    <DeviceMobile className="w-4 h-4" />
                                    <span>{t.nav.dashboard}</span>
                                </Link>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMobileMenuOpen(false);
                                        handleLogout();
                                    }}
                                    className="w-full text-center py-2.5 text-xs font-semibold text-destructive hover:bg-destructive/10 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5 touch-manipulation"
                                >
                                    <SignOut className="w-4 h-4" />
                                    <span>{t.nav.logout}</span>
                                </button>
                            </>
                        ) : (
                            <>
                                <Link
                                    href="/login"
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="w-full text-center py-3.5 rounded-xl border border-border text-foreground text-sm font-semibold hover:bg-muted transition-colors touch-manipulation"
                                >
                                    {t.nav.login}
                                </Link>
                                <Link
                                    href="/register"
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="w-full text-center py-3.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold shadow-xs transition-colors touch-manipulation"
                                >
                                    {t.nav.register}
                                </Link>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
