'use client';

import React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ArrowLeft } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';

export function FloatingBackButton() {
    const router = useRouter();
    const pathname = usePathname();
    const { t } = useTranslation();

    // Do not show back button on the root landing page
    if (pathname === '/') {
        return null;
    }

    const handleBack = () => {
        if (typeof window !== 'undefined' && window.history.length > 1) {
            router.back();
        } else {
            router.push('/');
        }
    };

    const labelText = t.statusPage?.back || 'Back';

    return (
        <button
            type="button"
            onClick={handleBack}
            aria-label={labelText}
            className="fixed top-20 left-4 sm:left-6 z-40 group inline-flex items-center gap-2 px-3 py-2 sm:px-3.5 sm:py-2 rounded-full border border-border bg-card/85 hover:bg-muted text-foreground text-xs font-semibold backdrop-blur-md shadow-md hover:shadow-lg transition-all active:scale-95 cursor-pointer touch-manipulation ring-1 ring-foreground/5 animate-in fade-in slide-in-from-top-2 duration-200"
        >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
            <span className="hidden sm:inline">{labelText}</span>
        </button>
    );
}
