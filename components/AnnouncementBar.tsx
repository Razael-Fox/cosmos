'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { X, ShieldCheck } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';

const ANNOUNCEMENT_DISMISSED_KEY = 'cosmos_announcement_dismissed_v1';

export function AnnouncementBar() {
  const { t } = useTranslation();
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    try {
      const dismissed = sessionStorage.getItem(ANNOUNCEMENT_DISMISSED_KEY);
      if (!dismissed) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial client hydration of dismissed state
        setIsDismissed(false);
      }
    } catch {
      setIsDismissed(false);
    }
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      sessionStorage.setItem(ANNOUNCEMENT_DISMISSED_KEY, 'true');
    } catch {
      // ignore
    }
  };

  if (isDismissed) return null;

  return (
    <div
      role="region"
      aria-label="Announcement"
      className="w-full bg-primary text-primary-foreground text-xs py-2 px-4 flex items-center justify-between border-b border-primary/20 transition-all"
    >
      <div className="flex-1 flex items-center justify-center gap-2 text-center truncate">
        <ShieldCheck className="w-4 h-4 shrink-0" weight="bold" />
        <span className="font-medium truncate">{t.announcement.message}</span>
        <Link
          href="/register"
          className="font-bold underline underline-offset-2 hover:opacity-90 transition-opacity ml-1 shrink-0"
        >
          {t.announcement.cta}
        </Link>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="p-1 text-primary-foreground/80 hover:text-primary-foreground rounded-md transition-colors shrink-0"
        aria-label="Dismiss announcement"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
