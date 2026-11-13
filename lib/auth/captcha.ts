// Captcha for the Supabase Auth calls that anyone can make without a
// session: password sign-up, password sign-in and the password reset email.
// The provider is Cloudflare Turnstile. Google sign-in needs none: Google
// does its own bot checks, and Supabase Auth does not ask for a token there.
//
// It is configuration-driven. Without NEXT_PUBLIC_TURNSTILE_SITE_KEY no
// widget renders and no token is sent, which is what local development and
// any environment that has not enabled captcha in Supabase Auth need. With
// it, the forms send a token, and Supabase Auth verifies it only once captcha
// is enabled in the project (with the matching secret). Supabase ignores a
// token while captcha is off, so the site key goes live first and the
// Supabase setting last (docs/upgrade-notes.md).
//
// Shared by the server actions, the form components and the service worker,
// so it imports nothing.

/** The form field that carries the Turnstile token to the server actions. */
export const CAPTCHA_TOKEN_FIELD = "captchaToken";

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Explicit rendering: the forms call turnstile.render() themselves, so the
 * widget can be reset after each submit and removed when the form unmounts.
 * Cloudflare requires this exact URL, never a cached or proxied copy.
 */
export const TURNSTILE_SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

/**
 * Turnstile "action" names, one per form, shown in the Cloudflare analytics.
 * Letters, digits, "-" and "_" only, at most 32 characters.
 */
export const CAPTCHA_ACTIONS = {
  signin: "signin",
  signup: "signup",
  reset: "password-reset",
} as const;

export type CaptchaAction =
  (typeof CAPTCHA_ACTIONS)[keyof typeof CAPTCHA_ACTIONS];

/** Supabase Auth refused or could not verify the token. */
export const CAPTCHA_FAILED_MESSAGE =
  "No se pudo completar la verificación de seguridad. Esperá a que se renueve e intentá de nuevo.";

/** Submitted before the widget handed out a token. */
export const CAPTCHA_PENDING_MESSAGE =
  "Esperá a que termine la verificación de seguridad e intentá de nuevo.";

/** The widget script did not load, or the challenge keeps failing. */
export const CAPTCHA_UNAVAILABLE_MESSAGE =
  "No se pudo cargar la verificación de seguridad. Revisá tu conexión, desactivá los bloqueadores de contenido para esta página y tocá Reintentar.";

/**
 * The public site key, or null when captcha is off. The literal
 * `process.env.NEXT_PUBLIC_*` lookup lets Next inline it into the browser
 * bundle; `env` is for tests.
 */
export function getTurnstileSiteKey(
  env: { NEXT_PUBLIC_TURNSTILE_SITE_KEY?: string } = {
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  }
): string | null {
  return env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
}

/**
 * The token a form submitted, or "" when there is none. A token is opaque to
 * the app (Supabase Auth verifies it); this only drops what cannot be one.
 * Turnstile tokens are at most 2048 characters.
 */
export function readCaptchaToken(formData: FormData): string {
  const value = formData.get(CAPTCHA_TOKEN_FIELD);
  if (typeof value !== "string") return "";
  const token = value.trim();
  return token.length > 0 && token.length <= 2048 ? token : "";
}

/**
 * The `captchaToken` option for supabase.auth.signUp, signInWithPassword and
 * resetPasswordForEmail. Empty without a token, so a request without captcha
 * is the same as before captcha existed.
 */
export function captchaOptions(token: string): { captchaToken?: string } {
  return token ? { captchaToken: token } : {};
}

/** True for the Auth error Supabase returns when the captcha check fails. */
export function isCaptchaError(
  error: { code?: string | null } | null | undefined
): boolean {
  return error?.code === "captcha_failed";
}

/**
 * Requests to Turnstile (its script and anything else the page fetches from
 * it). The service worker sends them to the network only: Cloudflare forbids
 * caching the script, and a stale one fails the challenge.
 */
export function isTurnstileUrl(url: URL): boolean {
  return url.origin === TURNSTILE_ORIGIN;
}
