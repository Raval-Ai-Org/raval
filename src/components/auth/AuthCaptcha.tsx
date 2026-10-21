"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthCaptchaToken } from "@/lib/auth-captcha";

type Turnstile = {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      theme: "auto";
      size: "flexible";
      appearance: "interaction-only";
      "response-field": false;
      callback(token: string): void;
      "expired-callback"(): void;
      "timeout-callback"(): void;
      "error-callback"(): void;
    },
  ): string;
  remove(id: string): void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

export function useAuthCaptcha() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  const [tokens] = useState(() => new AuthCaptchaToken(Boolean(siteKey)));
  const [ready, setReady] = useState(!siteKey);
  const [generation, setGeneration] = useState(0);
  const clear = useCallback(() => {
    tokens.clear();
    setReady(!tokens.enabled);
  }, [tokens]);
  const verify = useCallback(
    (token: string) => {
      tokens.accept(token);
      setReady(Boolean(token) && token.length <= 2048);
    },
    [tokens],
  );
  const reset = useCallback(() => {
    clear();
    if (tokens.enabled) setGeneration((value) => value + 1);
  }, [clear, tokens]);
  const take = useCallback(() => tokens.take(), [tokens]);
  return { siteKey, ready, generation, clear, verify, reset, take };
}

export type AuthCaptchaState = ReturnType<typeof useAuthCaptcha>;

/** Only mounted on authentication pages and only loads the SDK when configured. */
export function AuthCaptcha({ state }: { state: AuthCaptchaState }) {
  const host = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const { siteKey, generation, clear, verify } = state;

  useEffect(() => {
    if (!siteKey || !loaded || !host.current || !window.turnstile) return;
    const api = window.turnstile;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      if (!active) return;
      clearTimeout(timer);
      clear();
    };
    const fail = () => {
      invalidate();
      if (active) setFailed(true);
    };
    clear();
    setFailed(false);
    timer = setTimeout(fail, 20_000);
    let id: string | undefined;
    try {
      id = api.render(host.current, {
        sitekey: siteKey,
        theme: "auto",
        size: "flexible",
        appearance: "interaction-only",
        "response-field": false,
        callback: (token) => {
          if (!active) return;
          clearTimeout(timer);
          setFailed(false);
          verify(token);
          timer = setTimeout(invalidate, 290_000);
        },
        "expired-callback": invalidate,
        "timeout-callback": fail,
        "error-callback": fail,
      });
    } catch {
      fail();
    }
    return () => {
      active = false;
      clearTimeout(timer);
      clear();
      if (id) {
        try {
          api.remove(id);
        } catch {
          /* The SDK may already have removed an expired widget. */
        }
      }
    };
  }, [siteKey, loaded, generation, retry, clear, verify]);

  if (!siteKey) return null;
  return (
    <div className="space-y-2" data-auth-captcha>
      <Script
        id="mellox-auth-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => {
          if (window.turnstile) setLoaded(true);
          else {
            clear();
            setFailed(true);
          }
        }}
        onError={() => {
          clear();
          setFailed(true);
        }}
      />
      <div ref={host} />
      {!state.ready && (
        <p role="status" aria-live="polite" className="text-center text-xs text-muted-foreground">
          {failed
            ? "The security check could not finish. Check your connection, then retry."
            : "Completing security check…"}
          {failed && (
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                if (!loaded) window.location.reload();
                else setRetry((value) => value + 1);
              }}
            >
              Retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}
