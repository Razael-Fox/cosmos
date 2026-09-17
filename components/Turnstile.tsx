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
          'error-callback'?: (errorCode: string | number) => void;
          'expired-callback'?: () => void;
          'timeout-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact' | 'flexible' | 'invisible';
          retry?: 'auto' | 'never';
          'retry-interval'?: number;
          'refresh-expired'?: 'auto' | 'manual' | 'never';
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
      getResponse: (widgetId: string) => string | undefined;
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
  const [renderError, setRenderError] = useState<string | null>(null);

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
      setRenderError(null);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetIdRef.current);
        } catch {
          // ignore
        }
      }
    },
  }));

  const handleManualRetry = () => {
    setRenderError(null);
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch (err) {
        console.error('[Turnstile] Manual retry failed:', err);
      }
    }
  };

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
            setRenderError(null);
            onVerifyRef.current(token);
          }
        },
        'expired-callback': () => {
          if (!isCancelled && onExpireRef.current) {
            onExpireRef.current();
          }
        },
        'timeout-callback': () => {
          if (!isCancelled) {
            setRenderError(
              'Verification timed out. Please check your connection and retry.'
            );
            if (onErrorRef.current) {
              onErrorRef.current('timeout');
            }
          }
        },
        'error-callback': (code) => {
          if (!isCancelled) {
            console.error(
              `[Turnstile] Widget error (sitekey ${siteKey.slice(0, 6)}...):`,
              code
            );
            // Stop Cloudflare auto-retry loop (retry: 'never' below) and
            // surface a manual retry instead of spinning forever. The most
            // common persistent code here is 600010 (hostname not allowlisted
            // for this sitekey in the Cloudflare dashboard).
            setRenderError(
              'Verification failed to load. Please disable ad-blockers/VPN, verify this domain is allowlisted for the Turnstile sitekey, then retry.'
            );
            if (onErrorRef.current) {
              onErrorRef.current(code);
            }
            // If in local dev or network blocks Cloudflare, provide mock verification token
            if (process.env.NODE_ENV !== 'production' || siteKey === DEFAULT_TEST_SITE_KEY) {
              onVerifyRef.current('mock-cf-turnstile-token-dev');
            }
          }
        },
        theme,
        // Prevent the infinite spinner loop: on persistent errors (e.g. wrong
        // sitekey or non-allowlisted domain) Cloudflare would otherwise remove
        // and re-insert the challenge iframe forever. Fail once and let the
        // user retry manually via the button below.
        retry: 'never',
        'refresh-expired': 'auto',
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
      {renderError && (
        <div role="alert" className="mt-2 w-full max-w-sm p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-center">
          <p className="text-xs text-destructive font-medium">{renderError}</p>
          <button
            type="button"
            onClick={handleManualRetry}
            className="mt-2 px-3 py-1.5 rounded-lg bg-card border border-border text-xs font-semibold hover:bg-muted transition-colors"
          >
            Retry verification
          </button>
        </div>
      )}
      <noscript>
        <p className="text-xs text-muted-foreground mt-1">
          JavaScript is required for Cloudflare Turnstile verification.
        </p>
      </noscript>
    </div>
  );
});
