'use client';

import React, { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
    WhatsappLogo,
    Lock,
    EnvelopeSimple,
    CircleNotch,
    ShieldCheck,
    Lightning,
    Eye,
    EyeSlash,
    ArrowRight
} from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { registerInverted, registerDirect } from '@/lib/api';
import type { RegisterInvertedResponse } from '@/lib/types';
import { Turnstile, type TurnstileRef } from '@/components/Turnstile';
import { InvertedVerifyDialog } from '@/components/InvertedVerifyDialog';
import { DirectOtpModal } from '@/components/DirectOtpModal';
import { AuthShell } from '@/components/AuthShell';
import { Field } from '@/components/ui/field';

export default function RegisterPage() {
    const { t } = useTranslation();
    const [mode, setMode] = useState<'inverted' | 'direct'>('inverted');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
    const [phoneError, setPhoneError] = useState<string | null>(null);
    const [passwordError, setPasswordError] = useState<string | null>(null);

    // Inverted verification modal state
    const [invertedData, setInvertedData] = useState<RegisterInvertedResponse | null>(null);

    // Direct OTP modal state
    const [showDirectModal, setShowDirectModal] = useState(false);
    const [directExpiresIn, setDirectExpiresIn] = useState(300);

    const cleanPhone = phone.replace(/\D/g, '');
    const jidPreview = cleanPhone ? `${cleanPhone}@s.whatsapp.net` : null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        setPhoneError(null);
        setPasswordError(null);

        if (!cleanPhone || cleanPhone.length < 10) {
            setPhoneError(t.auth.invalidPhone);
            return;
        }

        if (password && password.length < 6) {
            setPasswordError(t.auth.passwordMinLength);
            return;
        }

        if (password && password !== confirmPassword) {
            setPasswordError(t.auth.passwordMismatch);
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
                    email: email.trim() || undefined,
                    password: password || undefined,
                    turnstileToken
                });
                setInvertedData(res);
            } else {
                const res = await registerDirect({
                    phone: cleanPhone,
                    email: email.trim() || undefined,
                    password: password || undefined,
                    turnstileToken
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
        <AuthShell currentStep={invertedData || showDirectModal ? 2 : 1}>
            <div className="space-y-6">
                {/* Mobile Header Brand (hidden on lg) */}
                <div className="lg:hidden text-center space-y-2">
                    <div className="inline-flex items-center justify-center">
                        <Image
                            src="/logo.png"
                            alt="Cosmos Logo"
                            width={48}
                            height={48}
                            className="w-12 h-12 rounded-xl object-contain shadow-xs"
                            priority
                        />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground font-heading">
                        {t.auth.registerTitle}
                    </h1>
                    <p className="text-xs text-muted-foreground">{t.auth.registerSubtitle}</p>
                </div>

                {/* Desktop Title */}
                <div className="hidden lg:block space-y-1">
                    <h1 className="text-2xl font-extrabold tracking-tight text-foreground font-heading">
                        {t.auth.registerTitle}
                    </h1>
                    <p className="text-xs text-muted-foreground">{t.auth.registerSubtitle}</p>
                </div>

                {/* Mode Selector Segmented Control */}
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-muted rounded-2xl border border-border">
                    <button
                        type="button"
                        onClick={() => {
                            setMode('inverted');
                            setErrorMsg(null);
                        }}
                        className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                            mode === 'inverted'
                                ? 'bg-card text-foreground shadow-xs'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                        aria-pressed={mode === 'inverted'}
                    >
                        <WhatsappLogo className="w-4 h-4 text-emerald-500" weight="fill" />
                        <span className="truncate">{t.auth.invertedTab}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setMode('direct');
                            setErrorMsg(null);
                        }}
                        className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                            mode === 'direct'
                                ? 'bg-card text-foreground shadow-xs'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                        aria-pressed={mode === 'direct'}
                    >
                        <Lightning className="w-4 h-4 text-amber-500" weight="fill" />
                        <span className="truncate">{t.auth.directTab}</span>
                    </button>
                </div>

                {/* Form Card */}
                <div className="p-6 sm:p-8 rounded-3xl bg-card border border-border shadow-md space-y-5">
                    {mode === 'inverted' ? (
                        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs flex items-start gap-2.5">
                            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" weight="bold" />
                            <span>
                                <strong>Zero Ban Risk:</strong> {t.auth.invertedInfo}
                            </span>
                        </div>
                    ) : (
                        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-start gap-2.5">
                            <Lightning className="w-4 h-4 shrink-0 mt-0.5" weight="fill" />
                            <span>{t.auth.directInfo}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Phone */}
                        <Field
                            label={t.auth.phoneLabel}
                            htmlFor="phone"
                            required
                            error={phoneError}
                            hint={jidPreview ? `${t.auth.phonePreviewPrefix} ${jidPreview}` : t.auth.phoneHelp}
                        >
                            <div className="relative">
                                <WhatsappLogo className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    id="phone"
                                    type="tel"
                                    required
                                    value={phone}
                                    onChange={(e) => {
                                        setPhone(e.target.value);
                                        if (phoneError) setPhoneError(null);
                                    }}
                                    placeholder={t.auth.phonePlaceholder}
                                    autoComplete="tel"
                                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                                />
                            </div>
                        </Field>

                        {/* Optional Email */}
                        <Field label={t.auth.emailLabel} htmlFor="email">
                            <div className="relative">
                                <EnvelopeSimple className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder={t.auth.emailPlaceholder}
                                    autoComplete="email"
                                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                                />
                            </div>
                        </Field>

                        {/* Password */}
                        <Field label={t.auth.passwordLabel} htmlFor="password" error={passwordError}>
                            <div className="relative">
                                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        if (passwordError) setPasswordError(null);
                                    }}
                                    placeholder={t.auth.passwordPlaceholder}
                                    autoComplete="new-password"
                                    className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                >
                                    {showPassword ? <EyeSlash className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </Field>

                        {/* Confirm Password (only if password provided) */}
                        {password && (
                            <Field label={t.auth.confirmPasswordLabel} htmlFor="confirm-password">
                                <div className="relative">
                                    <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    <input
                                        id="confirm-password"
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder={t.auth.passwordPlaceholder}
                                        autoComplete="new-password"
                                        className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                                    >
                                        {showConfirmPassword ? (
                                            <EyeSlash className="w-4 h-4" />
                                        ) : (
                                            <Eye className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                            </Field>
                        )}

                        {/* Cloudflare Turnstile */}
                        <div className="pt-2 flex flex-col items-center">
                            <Turnstile
                                ref={turnstileRef}
                                onVerify={handleTurnstileVerify}
                                onExpire={handleTurnstileExpire}
                                onError={handleTurnstileError}
                            />
                        </div>

                        {errorMsg && (
                            <div
                                role="alert"
                                className="p-3 text-xs text-center rounded-xl bg-destructive/10 text-destructive border border-destructive/20 font-medium"
                            >
                                {errorMsg}
                            </div>
                        )}

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isLoading || !cleanPhone || !turnstileToken}
                            className="w-full py-3.5 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                        >
                            {isLoading ? (
                                <>
                                    <CircleNotch className="w-4 h-4 animate-spin" />
                                    <span>{t.auth.loading}</span>
                                </>
                            ) : (
                                <>
                                    <span>
                                        {mode === 'inverted' ? t.auth.submitRegister : t.auth.submitRegisterDirect}
                                    </span>
                                    <ArrowRight className="w-4 h-4" />
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

                {/* Inverted Verification Modal */}
                {invertedData && (
                    <InvertedVerifyDialog
                        token={invertedData.token}
                        phoneNumber={cleanPhone}
                        clickToChatUrl={invertedData.clickToChatUrl}
                        clickToChatUrlDirect={invertedData.clickToChatUrlDirect}
                        regSessionId={invertedData.regSessionId}
                        expiresIn={invertedData.expiresIn}
                        onClose={() => setInvertedData(null)}
                    />
                )}

                {/* Direct OTP Modal */}
                {showDirectModal && (
                    <DirectOtpModal
                        phone={cleanPhone}
                        initialExpiresIn={directExpiresIn}
                        onClose={() => setShowDirectModal(false)}
                    />
                )}
            </div>
        </AuthShell>
    );
}
