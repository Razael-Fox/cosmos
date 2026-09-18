'use client';

import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { X, QrCode, Key, Copy, Check, CircleNotch, CheckCircle, DeviceMobile } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { pairSubBot, getStoredToken, createPairingWebSocket } from '@/lib/api';

interface PairingModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

const COUNTRY_CODES = [
    { code: '62', country: 'ID (+62)' },
    { code: '1', country: 'US/CA (+1)' },
    { code: '44', country: 'UK (+44)' },
    { code: '60', country: 'MY (+60)' },
    { code: '65', country: 'SG (+65)' },
    { code: '91', country: 'IN (+91)' },
    { code: '61', country: 'AU (+61)' },
    { code: '81', country: 'JP (+81)' }
];

export function PairingModal({ onClose, onSuccess }: PairingModalProps) {
    const { t } = useTranslation();
    const [method, setMethod] = useState<'code' | 'qr'>('code');
    const [selectedCountryCode, setSelectedCountryCode] = useState('62');
    const [localNumber, setLocalNumber] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [pairingCode, setPairingCode] = useState<string | null>(null);
    const [qrCodeData, setQrCodeData] = useState<string | null>(null);
    const [timeLeft, setTimeLeft] = useState(0);
    const [copied, setCopied] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isSuccess, setIsSuccess] = useState(false);
    const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);

    // Full clean phone number. Tolerates users pasting the full international
    // number (with country code) or a local number with trunk prefix 0:
    // the country code is prepended exactly once and a leading 0 is dropped.
    const digitsOnly = localNumber.replace(/\D/g, '');
    const withoutCountry = digitsOnly.startsWith(selectedCountryCode)
        ? digitsOnly.slice(selectedCountryCode.length)
        : digitsOnly;
    const withoutTrunk = withoutCountry.startsWith('0') ? withoutCountry.slice(1) : withoutCountry;
    const cleanPhone = `${selectedCountryCode}${withoutTrunk}`;

    // Countdown timer
    useEffect(() => {
        if (timeLeft <= 0) return;
        const interval = setInterval(() => {
            setTimeLeft((prev) => (prev <= 1 ? 0 : prev - 1));
        }, 1000);
        return () => clearInterval(interval);
    }, [timeLeft]);

    // Render raw Baileys QR payloads as scannable images.
    // qrImageUrl is reset alongside qrCodeData at every call site below.
    useEffect(() => {
        if (!qrCodeData || qrCodeData.startsWith('data:')) return;
        let cancelled = false;
        QRCode.toDataURL(qrCodeData, { width: 384, margin: 2 })
            .then((url) => {
                if (!cancelled) setQrImageUrl(url);
            })
            .catch(() => {
                if (!cancelled) setQrImageUrl(null);
            });
        return () => {
            cancelled = true;
        };
    }, [qrCodeData]);

    // WebSocket for pairing updates
    useEffect(() => {
        if (!pairingCode && !qrCodeData) return;
        const token = getStoredToken();
        if (!token) return;

        const cleanup = createPairingWebSocket(cleanPhone, token, (event) => {
            if (event.type === 'qr' && event.data) {
                setQrCodeData(event.data);
            } else if (event.type === 'code' && event.data) {
                setPairingCode(event.data);
            } else if (event.status === 'ACTIVE' || event.event === 'PAIRED') {
                setIsSuccess(true);
                setTimeout(() => {
                    onSuccess();
                    onClose();
                }, 2000);
            } else if (event.type === 'error') {
                setErrorMsg(
                    event.code === 'QUOTA_EXCEEDED' ? t.pairingModal.errorQuota : event.message || t.common.error
                );
            }
        });

        return () => cleanup();
    }, [pairingCode, qrCodeData, cleanPhone, onSuccess, onClose, t.pairingModal.errorQuota, t.common.error]);

    const handleRequestPairing = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!localNumber.trim()) return;

        setIsLoading(true);
        setErrorMsg(null);
        setPairingCode(null);
        setQrCodeData(null);
        setQrImageUrl(null);

        try {
            const res = await pairSubBot({
                phone: cleanPhone,
                method
            });

            if (method === 'code' && res.pairingCode) {
                setPairingCode(res.pairingCode);
                setTimeLeft(res.expiresIn || 180);
            } else if (method === 'qr' && res.qrCode) {
                setQrCodeData(res.qrCode);
                setTimeLeft(res.expiresIn || 60);
            } else {
                // The backend must return a genuine credential; never fabricate one.
                setErrorMsg(t.pairingModal.errorNoCredential);
            }
        } catch (err: unknown) {
            const errorObj = err as { data?: { code?: string }; status?: number; message?: string };
            if (errorObj.data?.code === 'QUOTA_EXCEEDED_SUBBOTS' || errorObj.status === 403) {
                setErrorMsg(t.pairingModal.errorQuota);
            } else {
                const msg = err instanceof Error ? err.message : t.common.error;
                setErrorMsg(msg);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = async () => {
        if (!pairingCode) return;
        try {
            await navigator.clipboard.writeText(pairingCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // ignore
        }
    };

    const formatSeconds = (sec: number) => {
        const mins = Math.floor(sec / 60);
        const rem = sec % 60;
        return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={t.pairingModal.title}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
        >
            <div className="w-full max-w-lg rounded-2xl bg-card p-6 md:p-8 shadow-2xl border border-border flex flex-col gap-6 relative max-h-[90vh] overflow-y-auto">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-muted-foreground hover:text-foreground p-1 rounded-lg transition-colors"
                    aria-label={t.common.close}
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="flex flex-col gap-2 text-center items-center">
                    <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                        <DeviceMobile className="w-7 h-7" weight="duotone" />
                    </div>
                    <h3 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
                        {t.pairingModal.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">{t.pairingModal.subtitle}</p>
                </div>

                {isSuccess ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-3 text-emerald-600 dark:text-emerald-400 text-center animate-in zoom-in-95">
                        <CheckCircle className="w-16 h-16" weight="fill" />
                        <h4 className="text-xl font-bold">{t.pairingModal.successTitle}</h4>
                        <p className="text-sm text-muted-foreground max-w-xs">{t.pairingModal.successDesc}</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-5">
                        {/* Method Tabs */}
                        <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-xl">
                            <button
                                type="button"
                                onClick={() => {
                                    setMethod('code');
                                    setPairingCode(null);
                                    setQrCodeData(null);
                                    setQrImageUrl(null);
                                }}
                                aria-pressed={method === 'code'}
                                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all ${
                                    method === 'code'
                                        ? 'bg-card text-foreground shadow-xs'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <Key className="w-4 h-4" />
                                <span>{t.pairingModal.methodCode}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setMethod('qr');
                                    setPairingCode(null);
                                    setQrCodeData(null);
                                    setQrImageUrl(null);
                                }}
                                aria-pressed={method === 'qr'}
                                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all ${
                                    method === 'qr'
                                        ? 'bg-card text-foreground shadow-xs'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <QrCode className="w-4 h-4" />
                                <span>{t.pairingModal.methodQr}</span>
                            </button>
                        </div>

                        {/* Input Form */}
                        {!pairingCode && !qrCodeData ? (
                            <form onSubmit={handleRequestPairing} className="flex flex-col gap-4">
                                <div className="flex flex-col gap-1.5">
                                    <label
                                        htmlFor="country-code-select"
                                        className="text-xs font-semibold text-foreground"
                                    >
                                        {t.pairingModal.phoneLabel}
                                    </label>
                                    <div className="flex gap-2">
                                        <select
                                            id="country-code-select"
                                            aria-label="Country code"
                                            value={selectedCountryCode}
                                            onChange={(e) => setSelectedCountryCode(e.target.value)}
                                            className="px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 shrink-0"
                                        >
                                            {COUNTRY_CODES.map((item) => (
                                                <option key={item.code} value={item.code}>
                                                    {item.country}
                                                </option>
                                            ))}
                                        </select>
                                        <input
                                            type="tel"
                                            value={localNumber}
                                            onChange={(e) => setLocalNumber(e.target.value.replace(/\D/g, ''))}
                                            placeholder={t.pairingModal.phonePlaceholder}
                                            required
                                            className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40"
                                        />
                                    </div>
                                    <span className="text-xs text-muted-foreground">{t.pairingModal.phoneHelp}</span>
                                </div>

                                <button
                                    type="submit"
                                    disabled={isLoading || !localNumber.trim()}
                                    className="w-full py-3 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {isLoading ? (
                                        <>
                                            <CircleNotch className="w-5 h-5 animate-spin" />
                                            <span>{t.pairingModal.loading}</span>
                                        </>
                                    ) : method === 'code' ? (
                                        <>
                                            <Key className="w-5 h-5" />
                                            <span>{t.pairingModal.requestBtn}</span>
                                        </>
                                    ) : (
                                        <>
                                            <QrCode className="w-5 h-5" />
                                            <span>{t.pairingModal.requestQrBtn}</span>
                                        </>
                                    )}
                                </button>
                            </form>
                        ) : method === 'code' && pairingCode ? (
                            /* Pairing Code Display */
                            <div className="flex flex-col gap-4 animate-in fade-in duration-200">
                                <div className="p-4 bg-muted/40 rounded-xl border border-border space-y-2 text-xs text-muted-foreground">
                                    <p className="font-semibold text-foreground">
                                        {t.pairingModal.instructionCodeTitle}
                                    </p>
                                    <p>{t.pairingModal.instructionStep1}</p>
                                    <p>{t.pairingModal.instructionStep2}</p>
                                    <p>{t.pairingModal.instructionStep3}</p>
                                </div>

                                <div className="flex flex-col items-center gap-3 p-6 bg-secondary/30 rounded-2xl border border-border">
                                    <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                                        {t.pairingModal.codeDisplayLabel}
                                    </span>
                                    <div className="flex items-center justify-center gap-3">
                                        <span className="text-3xl md:text-4xl font-mono font-bold tracking-widest text-primary select-all">
                                            {pairingCode}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={handleCopy}
                                            className="p-2.5 rounded-xl bg-background border border-border text-foreground hover:bg-muted transition-colors"
                                            title={t.pairingModal.copyCode}
                                            aria-label={t.pairingModal.copyCode}
                                        >
                                            {copied ? (
                                                <Check className="w-5 h-5 text-emerald-500" />
                                            ) : (
                                                <Copy className="w-5 h-5" />
                                            )}
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                                        <span>{t.pairingModal.countdown}</span>
                                        <span
                                            className={
                                                timeLeft < 30
                                                    ? 'text-destructive font-bold'
                                                    : 'text-foreground font-semibold'
                                            }
                                        >
                                            {formatSeconds(timeLeft)}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                                    <CircleNotch className="w-4 h-4 animate-spin text-primary" />
                                    <span>{t.pairingModal.waitingAuth}</span>
                                </div>
                            </div>
                        ) : (
                            /* QR Code Display */
                            <div className="flex flex-col items-center gap-4 animate-in fade-in duration-200">
                                <p className="text-xs text-muted-foreground text-center">{t.pairingModal.qrHelp}</p>
                                <div className="p-4 bg-white rounded-2xl border border-border shadow-sm flex items-center justify-center min-h-[220px] min-w-[220px]">
                                    {qrImageUrl || qrCodeData?.startsWith('data:') ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={qrImageUrl || qrCodeData || ''}
                                            alt="WhatsApp QR Code"
                                            className="w-48 h-48"
                                        />
                                    ) : (
                                        <div className="flex flex-col items-center gap-2 text-zinc-600">
                                            <QrCode className="w-36 h-36" />
                                            <span className="text-xs font-mono">{t.pairingModal.qrRendering}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                                    <span>{t.pairingModal.countdown}</span>
                                    <span className="font-semibold text-foreground">{formatSeconds(timeLeft)}</span>
                                </div>
                            </div>
                        )}

                        {errorMsg && (
                            <div
                                role="alert"
                                className="p-3 text-xs text-center rounded-lg bg-destructive/10 text-destructive border border-destructive/20 font-medium"
                            >
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
                        {t.pairingModal.close}
                    </button>
                </div>
            </div>
        </div>
    );
}
