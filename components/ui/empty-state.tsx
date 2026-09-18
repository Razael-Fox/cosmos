import React from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'p-10 text-center flex flex-col items-center justify-center gap-3 bg-card rounded-2xl border border-dashed border-border',
        className
      )}
    >
      <div className="w-12 h-12 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center">
        {icon}
      </div>
      <div className="space-y-1 max-w-sm">
        <h4 className="text-sm font-bold text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
