'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lock, User, CircleNotch, Sparkle, ArrowRight } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { login } from '@/lib/api';

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) return;

    setIsLoading(true);
    setErrorMsg(null);

    try {
      await login({
        identifier: identifier.trim(),
        password,
      });
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login gagal. Periksa kembali akun dan kata sandi Anda.';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background via-card/50 to-background">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-2xl bg-primary text-primary-foreground shadow-md">
            <Sparkle className="w-6 h-6" weight="fill" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground font-heading">
            {t.auth.loginTitle}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {t.auth.loginSubtitle}
          </p>
        </div>

        <div className="p-6 sm:p-8 rounded-3xl bg-card border border-border shadow-lg space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="identifier" className="text-xs font-semibold text-foreground">
                {t.auth.identifierLabel}
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="identifier"
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={t.auth.identifierPlaceholder}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="password" className="text-xs font-semibold text-foreground">
                {t.auth.passwordLabel}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t.auth.passwordPlaceholder}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 text-xs text-center rounded-xl bg-destructive/10 text-destructive border border-destructive/20 font-medium">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !identifier.trim() || !password}
              className="w-full py-3 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <CircleNotch className="w-4 h-4 animate-spin" />
                  <span>{t.auth.loading}</span>
                </>
              ) : (
                <>
                  <span>{t.auth.submitLogin}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="pt-2 text-center text-xs text-muted-foreground">
            <Link href="/register" className="hover:text-primary transition-colors font-medium">
              {t.auth.noAccount}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
