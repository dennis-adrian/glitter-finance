"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import {
  CAPTCHA_PENDING_MESSAGE,
  CAPTCHA_TOKEN_FIELD,
  CAPTCHA_UNAVAILABLE_MESSAGE,
  getTurnstileSiteKey,
  TURNSTILE_SCRIPT_URL,
  type CaptchaAction,
} from "@/lib/auth/captcha";
import { authLinkClassName } from "@/components/molecules/auth-form-fields";
import { cn } from "@/lib/utils";

// The Cloudflare Turnstile widget for the sign-up, sign-in and password
// reset forms (lib/auth/captcha.ts). Nothing renders, and no script loads,
// when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset.
//
// A token is single-use and expires after 5 minutes. The widget renews an
// expired one by itself ("refresh-expired": "auto"), and every submit resets
// it, so the next attempt, after an error, gets a new token.

type TurnstileRenderOptions = {
  sitekey: string;
  action?: string;
  theme?: "auto" | "light" | "dark";
  language?: string;
  size?: "normal" | "flexible" | "compact";
  "response-field"?: boolean;
  "refresh-expired"?: "auto" | "manual" | "never";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  "error-callback"?: (code: string) => boolean | void;
};

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: TurnstileRenderOptions
  ) => string | null | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type Captcha = ReturnType<typeof useCaptcha>;

/**
 * Captcha state for one form. Call checkBeforeSubmit from the form's
 * onSubmit: it stops a submit that has no token yet (when captcha is on) and
 * otherwise resets the widget once the submit has read the token.
 */
export function useCaptcha(action: CaptchaAction) {
  const siteKey = getTurnstileSiteKey();
  const [token, setToken] = useState("");
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [challengeFailed, setChallengeFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A callback ref kept in state: the widget renders once the element exists.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const api = window.turnstile;
    if (!siteKey || !scriptReady || !api || !container) return;

    const widgetId =
      api.render(container, {
        sitekey: siteKey,
        action,
        theme: "auto",
        language: "es",
        size: "flexible",
        // The form's own hidden input (CaptchaWidget) carries the token.
        "response-field": false,
        "refresh-expired": "auto",
        callback: (value) => {
          setToken(value);
          setChallengeFailed(false);
          setError(null);
        },
        "expired-callback": () => setToken(""),
        "timeout-callback": () => setToken(""),
        "error-callback": () => {
          setToken("");
          setChallengeFailed(true);
          // Handled: the widget shows Reintentar. Turnstile retries too.
          return true;
        },
      }) ?? null;
    widgetIdRef.current = widgetId;

    return () => {
      widgetIdRef.current = null;
      if (widgetId) api.remove(widgetId);
    };
  }, [siteKey, scriptReady, container, action]);

  const resetWidget = useCallback(() => {
    setToken("");
    const widgetId = widgetIdRef.current;
    if (widgetId) window.turnstile?.reset(widgetId);
  }, []);

  const retry = useCallback(() => {
    setChallengeFailed(false);
    setError(null);
    if (widgetIdRef.current) {
      resetWidget();
    } else {
      // The script itself never loaded: only a reload fetches it again.
      window.location.reload();
    }
  }, [resetWidget]);

  /** Returns false (and cancels the submit) when the form must wait. */
  function checkBeforeSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!siteKey || event.defaultPrevented) return !event.defaultPrevented;

    if (!token) {
      event.preventDefault();
      setError(
        scriptFailed || challengeFailed
          ? CAPTCHA_UNAVAILABLE_MESSAGE
          : CAPTCHA_PENDING_MESSAGE
      );
      return false;
    }

    setError(null);
    // After the submit: React builds the form data once every onSubmit
    // handler has run, so the token is already on its way. Supabase accepts
    // each token once, so the next attempt needs a new one.
    setTimeout(resetWidget, 0);
    return true;
  }

  return {
    siteKey,
    token,
    error,
    failed: scriptFailed || challengeFailed,
    setContainer,
    checkBeforeSubmit,
    retry,
    onScriptReady: () => setScriptReady(true),
    onScriptError: () => setScriptFailed(true),
  };
}

/** The widget and the hidden field with its token; nothing when captcha is off. */
export function CaptchaWidget({
  captcha,
  className,
}: {
  captcha: Captcha;
  className?: string;
}) {
  const { siteKey, token, failed, retry, setContainer } = captcha;
  if (!siteKey) return null;

  return (
    <div className={cn("grid gap-2", className)}>
      <Script
        src={TURNSTILE_SCRIPT_URL}
        strategy="afterInteractive"
        onReady={captcha.onScriptReady}
        onError={captcha.onScriptError}
      />
      {/* 65px: the height of the flexible widget, so the form does not jump. */}
      <div ref={setContainer} className="min-h-[65px] w-full" />
      <input type="hidden" name={CAPTCHA_TOKEN_FIELD} value={token} />
      {failed ? (
        <p role="status" className="text-sm leading-snug text-foreground/70">
          No se pudo completar la verificación de seguridad.{" "}
          <button type="button" onClick={retry} className={authLinkClassName}>
            Reintentar
          </button>
        </p>
      ) : null}
    </div>
  );
}
