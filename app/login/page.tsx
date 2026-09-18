'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Lock, User, CircleNotch, ArrowRight, Eye, EyeSlash } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { login } from '@/lib/api';
import { AuthShell } from '@/components/AuthShell';
import { Field } from '@/components/ui/field';

export default function LoginPage() {
    const { t } = useTranslation();
    const router = useRouter();
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
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
                password
            });
            router.push('/dashboard');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t.auth.loginFailed;
            setErrorMsg(msg);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AuthShell currentStep={1}>
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
                        {t.auth.loginTitle}
                    </h1>
                    <p className="text-xs text-muted-foreground">{t.auth.loginSubtitle}</p>
                </div>

                {/* Desktop Title */}
                <div className="hidden lg:block space-y-1">
                    <h1 className="text-2xl font-extrabold tracking-tight text-foreground font-heading">
                        {t.auth.loginTitle}
                    </h1>
                    <p className="text-xs text-muted-foreground">{t.auth.loginSubtitle}</p>
                </div>

                {/* Form Card */}
                <div className="p-6 sm:p-8 rounded-3xl bg-card border border-border shadow-md space-y-5">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <Field label={t.auth.identifierLabel} htmlFor="identifier" required>
                            <div className="relative">
                                <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    id="identifier"
                                    type="text"
                                    required
                                    value={identifier}
                                    onChange={(e) => setIdentifier(e.target.value)}
                                    placeholder={t.auth.identifierPlaceholder}
                                    autoComplete="username"
                                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                                />
                            </div>
                        </Field>

                        <Field label={t.auth.passwordLabel} htmlFor="password" required>
                            <div className="relative">
                                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={t.auth.passwordPlaceholder}
                                    autoComplete="current-password"
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

                        {errorMsg && (
                            <div
                                role="alert"
                                className="p-3 text-xs text-center rounded-xl bg-destructive/10 text-destructive border border-destructive/20 font-medium"
                            >
                                {errorMsg}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading || !identifier.trim() || !password}
                            className="w-full py-3.5 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
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

                    <div className="pt-2 flex flex-col items-center gap-2 text-xs text-muted-foreground text-center">
                        <Link href="/register" className="hover:text-primary transition-colors font-medium">
                            {t.auth.noAccount}
                        </Link>
                        <p className="text-[11px] text-muted-foreground/70">{t.auth.forgotPasswordHint}</p>
                    </div>
                </div>
            </div>
        </AuthShell>
    );
}
