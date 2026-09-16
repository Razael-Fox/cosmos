'use client';

import React, {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from 'react';

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

export interface TurnstileRef {
  reset: () => void;
}

export interface TurnstileProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (error: unknown) => void;
  className?: string;
  theme?: 'light' | 'dark' | 'auto';
}

const DEFAULT_TEST_SITE_KEY = '1x00000000000000000000AA'; // Cloudflare official test sitekey (always passes)

export const Turnstile = forwardRef<TurnstileRef, TurnstileProps>(function Turnstile(
  { onVerify, onExpire, onError, className, theme = 'auto' },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;

  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [isScriptLoaded, setIsScriptLoaded] = useState(() => {
    return typeof window !== 'undefined' && !!window.turnstile;
  });
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || DEFAULT_TEST_SITE_KEY;

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetIdRef.current);
        } catch {
          // ignore
        }
      }
    },
  }));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.turnstile) {
      setIsScriptLoaded(true);
      return;
    }

    const scriptId = 'cf-turnstile-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    const handleLoad = () => {
      setIsScriptLoaded(true);
    };

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = handleLoad;
      document.head.appendChild(script);
    } else {
      if (window.turnstile) {
        setIsScriptLoaded(true);
      } else {
        script.addEventListener('load', handleLoad);
        return () => {
          script?.removeEventListener('load', handleLoad);
        };
      }
    }
  }, []);

  useEffect(() => {
    if (!isScriptLoaded || !containerRef.current || !window.turnstile) return;

    // Avoid duplicate render
    if (widgetIdRef.current) return;

    let isCancelled = false;

    try {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }

      const id = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          if (!isCancelled) {
            onVerifyRef.current(token);
          }
        },
        'expired-callback': () => {
          if (!isCancelled && onExpireRef.current) {
            onExpireRef.current();
          }
        },
        'error-callback': (err) => {
          if (!isCancelled) {
            if (onErrorRef.current) {
              onErrorRef.current(err);
            }
            // If in local dev or network blocks Cloudflare, provide mock verification token
            if (process.env.NODE_ENV !== 'production' || siteKey === DEFAULT_TEST_SITE_KEY) {
              onVerifyRef.current('mock-cf-turnstile-token-dev');
            }
          }
        },
        theme,
      });
      widgetIdRef.current = id;
    } catch (err) {
      // Fallback in case of render error
      console.error('[Turnstile] Render error:', err);
      if (process.env.NODE_ENV !== 'production' || siteKey === DEFAULT_TEST_SITE_KEY) {
        onVerifyRef.current('mock-cf-turnstile-token-dev');
      }
    }

    return () => {
      isCancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
        widgetIdRef.current = null;
      }
    };
  }, [isScriptLoaded, siteKey, theme]);

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
});
