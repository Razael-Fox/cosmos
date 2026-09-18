import React from 'react';
import { cn } from '@/lib/utils';

interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
    label: string;
    htmlFor?: string;
    required?: boolean;
    error?: string | null;
    hint?: string | null;
}

export function Field({ label, htmlFor, required, error, hint, children, className, ...props }: FieldProps) {
    return (
        <div className={cn('space-y-1.5 text-left', className)} {...props}>
            <label htmlFor={htmlFor} className="block text-xs font-semibold text-foreground tracking-wide">
                {label} {required && <span className="text-destructive">*</span>}
            </label>
            {children}
            {hint && !error && <p className="text-[11px] text-muted-foreground leading-normal">{hint}</p>}
            {error && (
                <p role="alert" className="text-[11px] font-medium text-destructive leading-normal">
                    {error}
                </p>
            )}
        </div>
    );
}
