'use client';

import React, { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { SignOut, List, X, DeviceMobile } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from '@/lib/i18n';
import { clearStoredToken } from '@/lib/api';
import { LanguageDropdown } from '@/components/LanguageDropdown';
import { cn } from '@/lib/utils';

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

    const closeMenu = useCallback(() => {
        setMobileMenuOpen(false);
    }, []);

    const toggleMenu = useCallback(() => {
        setMobileMenuOpen((prev) => !prev);
    }, []);

    // Close mobile drawer on escape key
    useEffect(() => {
        if (!mobileMenuOpen) return;
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeMenu();
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [mobileMenuOpen, closeMenu]);

    // Close mobile drawer when resizing up to desktop
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 768 && mobileMenuOpen) {
                closeMenu();
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [mobileMenuOpen, closeMenu]);

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

            {/* Mobile Backdrop & Drawer with macOS Dock Genie Expansion Animation */}
            <AnimatePresence>
                {mobileMenuOpen && (
                    <>
                        {/* Mobile Backdrop Overlay */}
                        <motion.div
                            key="mobile-nav-backdrop"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.22, ease: 'easeOut' }}
                            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs md:hidden pointer-events-auto"
                            onClick={closeMenu}
                            aria-hidden="true"
                        />

                        {/* Mobile Drawer Panel (Genie expansion directly from bottom capsule) */}
                        <motion.div
                            key="mobile-nav-drawer-panel"
                            id="mobile-nav-drawer"
                            role="dialog"
                            aria-modal="true"
                            aria-label="Mobile Navigation"
                            initial={{
                                opacity: 0,
                                scaleY: 0.2,
                                scaleX: 0.45,
                                y: 55,
                                filter: 'blur(10px)',
                            }}
                            animate={{
                                opacity: 1,
                                scaleY: 1,
                                scaleX: 1,
                                y: 0,
                                filter: 'blur(0px)',
                            }}
                            exit={{
                                opacity: 0,
                                scaleY: 0.2,
                                scaleX: 0.45,
                                y: 50,
                                filter: 'blur(8px)',
                                transition: {
                                    duration: 0.2,
                                    ease: [0.32, 0, 0.67, 0],
                                },
                            }}
                            transition={{
                                type: 'spring',
                                damping: 25,
                                stiffness: 280,
                                mass: 0.8,
                            }}
                            style={{ transformOrigin: 'bottom center' }}
                            className="fixed bottom-20 inset-x-4 max-w-sm sm:max-w-md mx-auto z-50 md:hidden pointer-events-auto will-change-transform"
                        >
                            <div className="w-full max-h-[calc(100dvh-7.5rem)] rounded-3xl bg-card/95 backdrop-blur-2xl border border-border/80 shadow-2xl ring-1 ring-foreground/10 p-5 flex flex-col gap-4 overflow-hidden">
                                {/* Drawer Header Bar */}
                                <div className="flex items-center justify-between pb-3 border-b border-border/70 shrink-0">
                                    <Link
                                        href="/"
                                        onClick={closeMenu}
                                        className="flex items-center gap-2.5"
                                    >
                                        <Image
                                            src="/logo.png"
                                            alt="Cosmos Logo"
                                            width={28}
                                            height={28}
                                            className="w-7 h-7 object-contain"
                                        />
                                        <div className="flex flex-col">
                                            <span className="font-heading font-extrabold text-sm tracking-tight text-foreground">
                                                {t.nav.brand}
                                            </span>
                                            <span className="text-[10px] -mt-1 text-muted-foreground font-mono">
                                                {t.nav.portalBadge}
                                            </span>
                                        </div>
                                    </Link>

                                    <button
                                        type="button"
                                        onClick={closeMenu}
                                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors cursor-pointer touch-manipulation"
                                        aria-label="Close Menu"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Drawer Nav Links */}
                                <nav className="flex flex-col gap-1 overflow-y-auto max-h-56 pr-1">
                                    {navLinks.map((link) => {
                                        const isActive = pathname === link.href;
                                        return (
                                            <Link
                                                key={link.href}
                                                href={link.href}
                                                onClick={closeMenu}
                                                className={cn(
                                                    'py-2.5 px-3.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between touch-manipulation',
                                                    isActive
                                                        ? 'bg-primary/15 text-primary dark:text-emerald-400 font-bold'
                                                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                                                )}
                                            >
                                                <span>{link.name}</span>
                                                {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                                            </Link>
                                        );
                                    })}
                                </nav>

                                {/* Drawer Auth Actions */}
                                <div className="pt-3 border-t border-border/70 shrink-0 flex flex-col gap-2">
                                    {isAuthenticated ? (
                                        <>
                                            <Link
                                                href="/dashboard"
                                                onClick={closeMenu}
                                                className="w-full text-center py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-colors touch-manipulation"
                                            >
                                                <DeviceMobile className="w-3.5 h-3.5" />
                                                <span>{t.nav.dashboard}</span>
                                            </Link>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    closeMenu();
                                                    handleLogout();
                                                }}
                                                className="w-full text-center py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5 touch-manipulation"
                                            >
                                                <SignOut className="w-3.5 h-3.5" />
                                                <span>{t.nav.logout}</span>
                                            </button>
                                        </>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-2">
                                            <Link
                                                href="/login"
                                                onClick={closeMenu}
                                                className="w-full text-center py-2.5 rounded-xl border border-border text-foreground text-xs font-semibold hover:bg-muted transition-colors touch-manipulation"
                                            >
                                                {t.nav.login}
                                            </Link>
                                            <Link
                                                href="/register"
                                                onClick={closeMenu}
                                                className="w-full text-center py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-xs transition-colors touch-manipulation"
                                            >
                                                {t.nav.register}
                                            </Link>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Mobile Bottom Capsule Floating Component (Dock-anchored at bottom) */}
            <div className="fixed bottom-5 inset-x-0 z-50 flex justify-center items-center pointer-events-none md:hidden px-4">
                <div className="pointer-events-auto inline-flex items-center gap-1.5 p-1.5 rounded-full border border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl ring-1 ring-foreground/10 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    {/* Drawer Toggle Button */}
                    <button
                        type="button"
                        onClick={toggleMenu}
                        className={cn(
                            'flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold shadow-xs transition-all active:scale-95 cursor-pointer touch-manipulation',
                            mobileMenuOpen
                                ? 'bg-secondary hover:bg-muted text-foreground border border-border/80'
                                : 'bg-primary hover:bg-primary/90 text-primary-foreground'
                        )}
                        aria-label={mobileMenuOpen ? t.common.close : 'Open Navigation Drawer'}
                        aria-expanded={mobileMenuOpen}
                        aria-controls="mobile-nav-drawer"
                    >
                        {mobileMenuOpen ? (
                            <>
                                <X className="w-4 h-4 text-primary" weight="bold" />
                                <span>{t.common.close}</span>
                            </>
                        ) : (
                            <>
                                <List className="w-4 h-4" weight="bold" />
                                <span>Menu</span>
                            </>
                        )}
                    </button>

                    {/* Subtle Vertical Divider */}
                    <div className="w-px h-5 bg-border/80 my-auto" />

                    {/* Language Switch Button with Dropdown (Upward display) */}
                    <LanguageDropdown variant="capsule" side="top" align="center" />
                </div>
            </div>
        </>
    );
}
