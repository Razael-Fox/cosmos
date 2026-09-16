'use client';

import React, { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'error-callback'?: (error: unknown) => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoaded?: () => void;
  }
}

interface TurnstileProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  className?: string;
}

const DEFAULT_TEST_SITE_KEY = '1x00000000000000000000AA'; // Cloudflare official test sitekey (always passes)

export function Turnstile({ onVerify, onExpire, className }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [isScriptLoaded, setIsScriptLoaded] = useState(() => {
    return typeof window !== 'undefined' && !!window.turnstile;
  });
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || DEFAULT_TEST_SITE_KEY;

  useEffect(() => {
    if (typeof window === 'undefined' || window.turnstile) return;

    const existingScript = document.getElementById('cf-turnstile-script');
    if (!existingScript) {
      const script = document.createElement('script');
      script.id = 'cf-turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => setIsScriptLoaded(true);
      document.head.appendChild(script);
    } else {
      existingScript.addEventListener('load', () => setIsScriptLoaded(true));
    }
  }, []);

  useEffect(() => {
    if (!isScriptLoaded || !containerRef.current || !window.turnstile) return;

    // Avoid duplicate render
    if (widgetIdRef.current) {
      try {
        window.turnstile.remove(widgetIdRef.current);
      } catch {
        // ignore
      }
      widgetIdRef.current = null;
    }

    try {
      const id = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          onVerify(token);
        },
        'expired-callback': () => {
          if (onExpire) onExpire();
        },
        'error-callback': (err) => {
          void err;
          // If in local dev or network blocks Cloudflare, provide mock verification token
          if (process.env.NODE_ENV !== 'production' || siteKey === DEFAULT_TEST_SITE_KEY) {
            onVerify('mock-cf-turnstile-token-dev');
          }
        },
        theme: 'auto',
      });
      widgetIdRef.current = id;
    } catch {
      // Fallback in case of render error
      if (process.env.NODE_ENV !== 'production' || siteKey === DEFAULT_TEST_SITE_KEY) {
        onVerify('mock-cf-turnstile-token-dev');
      }
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
        widgetIdRef.current = null;
      }
    };
  }, [isScriptLoaded, siteKey, onVerify, onExpire]);

  return (
    <div className={`flex flex-col items-center justify-center my-3 ${className || ''}`}>
      <div ref={containerRef} className="min-h-[65px] flex items-center justify-center" />
      <noscript>
        <p className="text-xs text-muted-foreground mt-1">
          JavaScript is required for Cloudflare Turnstile verification.
        </p>
      </noscript>
    </div>
  );
}
