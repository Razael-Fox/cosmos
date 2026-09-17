'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WhatsappLogo, Copy, Check, CircleNotch, X } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { createAuthStatusWebSocket, setStoredToken } from '@/lib/api';

interface InvertedVerifyDialogProps {
  token: string; // Treated as opaque string
  clickToChatUrl: string;
  regSessionId: string;
  expiresIn: number; // in seconds
  onClose: () => void;
}

export function InvertedVerifyDialog({
  token,
  clickToChatUrl,
  regSessionId,
  expiresIn,
  onClose,
}: InvertedVerifyDialogProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(expiresIn || 300);
  const [isVerified, setIsVerified] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Expiry countdown timer
  useEffect(() => {
    if (timeLeft <= 0) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setErrorMsg(t.invertedVerify.timeout);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timeLeft, t.invertedVerify.timeout]);

  // WebSocket listener for real-time verification from WhatsApp
  useEffect(() => {
    if (!regSessionId || isVerified) return;

    const cleanup = createAuthStatusWebSocket(
      regSessionId,
      (msg) => {
        if (msg.status === 'VERIFIED') {
          setIsVerified(true);
          if (msg.jwtToken) {
            setStoredToken(msg.jwtToken);
          }
          setTimeout(() => {
            router.push('/dashboard');
          }, 1500);
        } else if (msg.status === 'EXPIRED') {
          setErrorMsg(t.invertedVerify.timeout);
        }
      },
      (err) => {
        void err;
        // Polling fallback inside createAuthStatusWebSocket will handle network retries
      }
    );

    return () => cleanup();
  }, [regSessionId, isVerified, router, t.invertedVerify.timeout]);

  const verifyCommand = `.verify ${token}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(verifyCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remainingSec = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${remainingSec.toString().padStart(2, '0')}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.invertedVerify.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-lg rounded-2xl bg-card p-6 md:p-8 shadow-2xl border border-border flex flex-col gap-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground p-1 rounded-lg transition-colors"
          aria-label={t.invertedVerify.cancel}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col gap-2 text-center items-center">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <WhatsappLogo className="w-7 h-7" weight="fill" />
          </div>
          <h3 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
            {t.invertedVerify.title}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            {t.invertedVerify.subtitle}
          </p>
        </div>

        {isVerified ? (
          <div className="flex flex-col items-center justify-center py-6 gap-3 text-emerald-600 dark:text-emerald-400 animate-in zoom-in-95 duration-200">
            <Check className="w-12 h-12 p-2 bg-emerald-500/20 rounded-full" weight="bold" />
            <span className="font-semibold text-base">{t.invertedVerify.success}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="space-y-2 text-sm text-muted-foreground bg-muted/40 p-4 rounded-xl border border-border">
              <p className="font-medium text-foreground">{t.invertedVerify.step1}</p>
              <p className="font-medium text-foreground">{t.invertedVerify.step2}</p>
              <div className="flex items-center justify-between gap-2 p-2.5 bg-background rounded-lg border border-border mt-1">
                <code className="text-xs font-mono font-semibold text-primary select-all break-all">
                  {verifyCommand}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors font-medium"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{t.invertedVerify.copied}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{t.invertedVerify.copyBtn}</span>
                    </>
                  )}
                </button>
              </div>
              <p className="font-medium text-foreground pt-1">{t.invertedVerify.step3}</p>
            </div>

            <a
              href={clickToChatUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2.5 w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-medium shadow-md transition-all text-center"
            >
              <WhatsappLogo className="w-5 h-5" weight="fill" />
              <span>{t.invertedVerify.whatsappBtn}</span>
            </a>

            <div className="flex flex-col items-center gap-2 pt-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CircleNotch className="w-4 h-4 animate-spin text-emerald-600" />
                <span>{t.invertedVerify.waitingWs}</span>
              </div>
              <span className="text-xs font-mono font-medium text-muted-foreground">
                {t.invertedVerify.expiresIn}{' '}
                <span className={timeLeft < 60 ? 'text-destructive font-bold' : 'text-foreground'}>
                  {formatSeconds(timeLeft)}
                </span>
              </span>
            </div>

            {errorMsg && (
              <div role="alert" className="p-3 text-xs text-center rounded-lg bg-destructive/10 text-destructive border border-destructive/20 font-medium">
                {errorMsg}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg transition-colors"
          >
            {t.invertedVerify.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
