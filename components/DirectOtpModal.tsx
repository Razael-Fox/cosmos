'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CircleNotch, X, ShieldCheck } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { verifyOtp, resendOtp } from '@/lib/api';
import { Turnstile } from './Turnstile';

interface DirectOtpModalProps {
  phone: string;
  initialExpiresIn?: number;
  onClose: () => void;
}

export function DirectOtpModal({
  phone,
  initialExpiresIn = 300,
  onClose,
}: DirectOtpModalProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [otp, setOtp] = useState('');
  const [timeLeft, setTimeLeft] = useState(initialExpiresIn);
  const [resendCooldown, setResendCooldown] = useState(60);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [showResendTurnstile, setShowResendTurnstile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleTurnstileVerify = useCallback((tok: string) => {
    setTurnstileToken(tok);
  }, []);

  const handleTurnstileExpire = useCallback(() => {
    setTurnstileToken(null);
  }, []);

  const handleTurnstileError = useCallback(() => {
    setTurnstileToken(null);
  }, []);

  useEffect(() => {
    if (timeLeft <= 0) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [timeLeft]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim() || otp.length < 6) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await verifyOtp({ phone, otp: otp.trim() });
      setSuccessMsg(t.common.success);
      setTimeout(() => {
        router.push('/dashboard');
      }, 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.directOtp.invalid;
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!turnstileToken) {
      setShowResendTurnstile(true);
      return;
    }

    setIsResending(true);
    setErrorMsg(null);

    try {
      const res = await resendOtp({ phone, turnstileToken });
      setTimeLeft(res.expiresIn || 300);
      setResendCooldown(60);
      setShowResendTurnstile(false);
      setTurnstileToken(null);
      setSuccessMsg(t.directOtp.resent);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.common.error;
      setErrorMsg(msg);
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.directOtp.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-md rounded-3xl bg-card p-6 md:p-8 shadow-2xl border border-border flex flex-col gap-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground p-1 rounded-lg transition-colors cursor-pointer"
          aria-label={t.common.close}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col gap-2 text-center items-center">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
            <ShieldCheck className="w-7 h-7" weight="bold" />
          </div>
          <h3 className="text-xl md:text-2xl font-bold tracking-tight text-foreground font-heading">
            {t.directOtp.title}
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {t.directOtp.subtitle}
          </p>
        </div>

        <form onSubmit={handleVerify} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="otp-input" className="text-xs font-semibold text-foreground uppercase tracking-wider">
              {t.directOtp.otpLabel}
            </label>
            <input
              id="otp-input"
              type="text"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder={t.directOtp.otpPlaceholder}
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              className="w-full tracking-[0.4em] text-center text-2xl font-mono py-3 px-4 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all font-semibold"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || otp.length < 6}
            className="w-full py-3 px-4 rounded-xl bg-primary hover:bg-primary/90 active:scale-[0.99] text-primary-foreground font-semibold shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <CircleNotch className="w-5 h-5 animate-spin" />
                <span>{t.auth.loading}</span>
              </>
            ) : (
              <>
                <Check className="w-5 h-5" weight="bold" />
                <span>{t.directOtp.verifyBtn}</span>
              </>
            )}
          </button>
        </form>

        {errorMsg && (
          <div role="alert" className="p-3 text-xs text-center rounded-xl bg-destructive/10 text-destructive border border-destructive/20 font-medium">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div role="status" aria-live="polite" className="p-3 text-xs text-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
            {successMsg}
          </div>
        )}

        {showResendTurnstile && (
          <div className="p-3 bg-muted/40 rounded-xl border border-border flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground">{t.auth.turnstileRequired}</p>
            <Turnstile
              onVerify={handleTurnstileVerify}
              onExpire={handleTurnstileExpire}
              onError={handleTurnstileError}
            />
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border text-xs text-muted-foreground">
          <div role="timer" aria-live="polite">
            {timeLeft > 0 ? (
              `${t.directOtp.expiresInLabel} ${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}`
            ) : (
              <span className="text-destructive font-medium">{t.directOtp.expired}</span>
            )}
          </div>

          {resendCooldown > 0 ? (
            <span>
              {t.directOtp.resendCountdown} {resendCooldown}s
            </span>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={isResending}
              className="text-primary hover:underline font-semibold cursor-pointer"
            >
              {isResending ? t.directOtp.resending : t.directOtp.resendBtn}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
