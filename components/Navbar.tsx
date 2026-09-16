'use client';

import React, { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  Globe,
  SignOut,
  List,
  X,
  Sparkle,
} from '@phosphor-icons/react';
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

  const isAuthenticated = useSyncExternalStore(
    subscribeToAuth,
    getAuthSnapshot,
    getAuthServerSnapshot
  );

  const handleLogout = () => {
    clearStoredToken();
    router.push('/login');
  };

  const toggleLanguage = () => {
    setLanguage(language === 'id' ? 'en' : 'id');
  };

  const navLinks = [
    { name: t.nav.home, href: '/' },
    { name: t.nav.pricing, href: '/pricing' },
    ...(isAuthenticated ? [{ name: t.nav.dashboard, href: '/dashboard' }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/80 bg-background/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold shadow-sm group-hover:scale-105 transition-transform">
            <Sparkle className="w-5 h-5" weight="fill" />
          </div>
          <div className="flex flex-col">
            <span className="font-heading font-extrabold text-lg tracking-tight text-foreground">
              {t.nav.brand}
            </span>
            <span className="text-[10px] -mt-1 text-muted-foreground font-mono hidden sm:inline-block">
              Multi-Device Portal
            </span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-foreground ${
                pathname === link.href ? 'text-primary font-semibold' : 'text-muted-foreground'
              }`}
            >
              {link.name}
            </Link>
          ))}
        </nav>

        {/* Right Action Buttons */}
        <div className="hidden md:flex items-center gap-3">
          {/* Language Toggle */}
          <button
            type="button"
            onClick={toggleLanguage}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Ganti Bahasa / Switch Language"
          >
            <Globe className="w-4 h-4" />
            <span>{language.toUpperCase()}</span>
          </button>

          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              <Link
                href="/dashboard"
                className="px-4 py-2 rounded-xl bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold border border-border transition-colors"
              >
                {t.nav.dashboard}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors"
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
          >
            {language.toUpperCase()}
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-muted-foreground hover:text-foreground"
            aria-label="Toggle Menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <List className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-border bg-card p-4 space-y-3">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className={`block py-2 text-sm font-medium ${
                pathname === link.href ? 'text-primary font-bold' : 'text-muted-foreground'
              }`}
            >
              {link.name}
            </Link>
          ))}

          <div className="pt-3 border-t border-border flex flex-col gap-2">
            {isAuthenticated ? (
              <>
                <Link
                  href="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold"
                >
                  {t.nav.dashboard}
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    handleLogout();
                  }}
                  className="w-full text-center py-2 text-xs font-semibold text-destructive"
                >
                  {t.nav.logout}
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center py-2.5 rounded-xl border border-border text-xs font-semibold"
                >
                  {t.nav.login}
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold"
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
