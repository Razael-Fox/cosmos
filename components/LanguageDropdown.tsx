'use client';

import React from 'react';
import { Globe, Check, CaretUp } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import type { Language } from '@/lib/dictionary';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface LanguageDropdownProps {
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    variant?: 'navbar' | 'capsule' | 'footer';
    className?: string;
}

export function LanguageDropdown({
    side = 'top',
    align = 'center',
    variant = 'navbar',
    className
}: LanguageDropdownProps) {
    const { language, setLanguage } = useTranslation();

    const languages: { code: Language; label: string; flag: string }[] = [
        { code: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
        { code: 'en', label: 'English', flag: '🇬🇧' }
    ];

    const getTriggerContent = () => {
        if (variant === 'capsule') {
            return (
                <>
                    <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-mono">{language.toUpperCase()}</span>
                    <CaretUp className="w-3 h-3 text-muted-foreground/70" />
                </>
            );
        }

        if (variant === 'footer') {
            return (
                <>
                    <Globe className="w-3.5 h-3.5" />
                    <span className="font-mono">{language === 'id' ? 'ID' : 'EN'}</span>
                    <span>({language === 'id' ? 'Bahasa Indonesia' : 'English'})</span>
                    <CaretUp className="w-3 h-3 text-muted-foreground/70" />
                </>
            );
        }

        // Default 'navbar' variant
        return (
            <>
                <Globe className="w-3.5 h-3.5" />
                <span className="font-mono">{language.toUpperCase()}</span>
                <CaretUp className="w-3 h-3 text-muted-foreground/70" />
            </>
        );
    };

    const triggerClassName =
        variant === 'capsule'
            ? 'flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold text-foreground hover:bg-muted/80 transition-colors cursor-pointer touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40'
            : variant === 'footer'
              ? 'flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40'
              : 'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40';

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className={cn(triggerClassName, className)}
                aria-label="Switch Language / Pilih Bahasa"
            >
                {getTriggerContent()}
            </DropdownMenuTrigger>
            <DropdownMenuContent
                side={side}
                align={align}
                sideOffset={8}
                className="w-48 p-1.5 shadow-xl border border-border bg-popover/95 backdrop-blur-md rounded-2xl animate-in fade-in-0 zoom-in-95 data-[side=top]:slide-in-from-bottom-2"
            >
                <DropdownMenuLabel className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Language / Bahasa
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="my-1 -mx-1" />
                {languages.map((item) => {
                    const isSelected = language === item.code;
                    return (
                        <DropdownMenuItem
                            key={item.code}
                            onClick={() => setLanguage(item.code)}
                            className={cn(
                                'flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium cursor-pointer transition-colors',
                                isSelected
                                    ? 'bg-primary/10 text-primary font-semibold'
                                    : 'text-foreground hover:bg-muted'
                            )}
                        >
                            <span className="flex items-center gap-2">
                                <span className="text-sm leading-none">{item.flag}</span>
                                <span>{item.label}</span>
                            </span>
                            {isSelected && <Check className="w-4 h-4 text-primary" weight="bold" />}
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
