'use client';

import React, { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  WhatsappLogo,
  Lock,
  User,
  EnvelopeSimple,
  CircleNotch,
  ShieldCheck,
  Lightning,
} from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { registerInverted, registerDirect } from '@/lib/api';
import type { RegisterInvertedResponse } from '@/lib/types';
import { Turnstile, type TurnstileRef } from '@/components/Turnstile';
import { InvertedVerifyDialog } from '@/components/InvertedVerifyDialog';
import { DirectOtpModal } from '@/components/DirectOtpModal';

export default function RegisterPage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'inverted' | 'direct'>('inverted');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileRef>(null);

  const handleTurnstileVerify = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

  const handleTurnstileExpire = useCallback(() => {
    setTurnstileToken(null);
  }, []);

  const handleTurnstileError = useCallback(() => {
    setTurnstileToken(null);
  }, []);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Inverted verification modal state
  const [invertedData, setInvertedData] = useState<RegisterInvertedResponse | null>(null);

  // Direct OTP modal state
  const [showDirectModal, setShowDirectModal] = useState(false);
  const [directExpiresIn, setDirectExpiresIn] = useState(300);

  const cleanPhone = phone.replace(/\D/g, '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!cleanPhone || cleanPhone.length < 9) {
      setErrorMsg('Masukkan nomor WhatsApp yang valid.');
      return;
    }

    if (password && password.length < 6) {
      setErrorMsg('Kata sandi minimal 6 karakter.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    if (!turnstileToken) {
      setErrorMsg(t.auth.turnstileRequired);
      return;
    }

    setIsLoading(true);

    try {
      if (mode === 'inverted') {
        const res = await registerInverted({
          phone: cleanPhone,
          username: username.trim() || undefined,
          email: email.trim() || undefined,
          password: password || undefined,
          turnstileToken,
        });
        setInvertedData(res);
      } else {
        const res = await registerDirect({
          phone: cleanPhone,
          username: username.trim() || undefined,
          email: email.trim() || undefined,
          password: password || undefined,
          turnstileToken,
        });
        setDirectExpiresIn(res.expiresIn || 300);
        setShowDirectModal(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.common.error;
      setErrorMsg(msg);
      setTurnstileToken(null);
      turnstileRef.current?.reset();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background via-card/50 to-background">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center">
            <Image
              src="/logo.png"
              alt="Cosmos Logo"
              width={56}
              height={56}
              className="w-14 h-14 rounded-2xl object-contain shadow-md"
              priority
            />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground font-heading">
            {t.auth.registerTitle}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {t.auth.registerSubtitle}
          </p>
        </div>

        {/* Mode Selector Tabs */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-muted rounded-2xl border border-border">
          <button
            type="button"
            onClick={() => {
              setMode('inverted');
              setErrorMsg(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-semibold transition-all ${
              mode === 'inverted'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <WhatsappLogo className="w-4 h-4 text-emerald-600" weight="fill" />
            <span>Mode WhatsApp (Aman)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('direct');
              setErrorMsg(null);
            }}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-semibold transition-all ${
              mode === 'direct'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Lightning className="w-4 h-4 text-amber-500" weight="fill" />
            <span>Mode OTP Langsung</span>
          </button>
        </div>

        {/* Form Card */}
        <div className="p-6 sm:p-8 rounded-3xl bg-card border border-border shadow-lg space-y-5">
          {mode === 'inverted' ? (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" weight="bold" />
              <span>
                <strong>Zero Ban Risk:</strong> Anda mengirim pesan verifikasi ke bot terlebih dahulu,
                sehingga WhatsApp memvalidasi interaksi sebagai pesan organik.
              </span>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-start gap-2.5">
              <Lightning className="w-4 h-4 shrink-0 mt-0.5" weight="fill" />
              <span>
                Bot akan mengirimkan kode OTP 6-digit ke nomor WhatsApp Anda. Dibatasi 5 kali per 15 menit.
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Phone */}
            <div className="space-y-1">
              <label htmlFor="phone" className="text-xs font-semibold text-foreground">
                {t.auth.phoneLabel} <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <WhatsappLogo className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t.auth.phonePlaceholder}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">{t.auth.phoneHelp}</p>
            </div>

            {/* Username */}
            <div className="space-y-1">
              <label htmlFor="username" className="text-xs font-semibold text-foreground">
                {t.auth.usernameLabel}
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t.auth.usernamePlaceholder}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1">
              <label htmlFor="email" className="text-xs font-semibold text-foreground">
                {t.auth.emailLabel}
              </label>
              <div className="relative">
                <EnvelopeSimple className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.auth.emailPlaceholder}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label htmlFor="password" className="text-xs font-semibold text-foreground">
                {t.auth.passwordLabel}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t.auth.passwordPlaceholder}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                />
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-1">
              <label htmlFor="confirmPassword" className="text-xs font-semibold text-foreground">
                {t.auth.confirmPasswordLabel}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t.auth.passwordPlaceholder}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                />
              </div>
            </div>

            {/* Cloudflare Turnstile */}
            <div className="pt-2">
              <Turnstile
                ref={turnstileRef}
                onVerify={handleTurnstileVerify}
                onExpire={handleTurnstileExpire}
                onError={handleTurnstileError}
              />
            </div>

            {errorMsg && (
              <div className="p-3 text-xs text-center rounded-xl bg-destructive/10 text-destructive border border-destructive/20 font-medium">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !turnstileToken}
              className="w-full py-3 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <CircleNotch className="w-4 h-4 animate-spin" />
                  <span>{t.auth.loading}</span>
                </>
              ) : mode === 'inverted' ? (
                <>
                  <WhatsappLogo className="w-4 h-4" weight="fill" />
                  <span>{t.auth.submitRegister}</span>
                </>
              ) : (
                <>
                  <Lightning className="w-4 h-4" weight="fill" />
                  <span>{t.auth.submitRegisterDirect}</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-2 text-center text-xs text-muted-foreground">
            <Link href="/login" className="hover:text-primary transition-colors font-medium">
              {t.auth.alreadyHaveAccount}
            </Link>
          </div>
        </div>
      </div>

      {/* Modal Dialogs */}
      {invertedData && (
        <InvertedVerifyDialog
          token={invertedData.token}
          clickToChatUrl={invertedData.clickToChatUrl}
          regSessionId={invertedData.regSessionId}
          expiresIn={invertedData.expiresIn}
          onClose={() => setInvertedData(null)}
        />
      )}

      {showDirectModal && (
        <DirectOtpModal
          phone={cleanPhone}
          initialExpiresIn={directExpiresIn}
          onClose={() => setShowDirectModal(false)}
        />
      )}
    </div>
  );
}
