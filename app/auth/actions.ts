"use server";

import { redirect } from "next/navigation";
import {
  isInviteRedirectPath,
  sanitizeRedirectPath,
} from "@/lib/auth/redirect";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import {
  INVITE_ORIGIN_UNAVAILABLE_MESSAGE,
  isAbsoluteHttpUrl,
} from "@/lib/invitations/validation";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

const ACCOUNT_PREPARATION_ERROR_MESSAGE = "No se pudo preparar la cuenta.";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

// Build a /login redirect that preserves the sanitized `next` so a failed
// attempt (bad credentials, bootstrap error) still hands off to the invite or
// other deep-link flow once the user succeeds.
function loginRedirectUrl(
  params: { error?: string; message?: string },
  next: string,
  mode: "signin" | "signup" = "signin"
): string {
  const search = new URLSearchParams();
  if (mode === "signup") {
    search.set("mode", "signup");
  }
  if (params.error) {
    search.set("error", params.error);
  }
  if (params.message) {
    search.set("message", params.message);
  }
  if (next !== "/") {
    search.set("next", next);
  }
  return `/login?${search.toString()}`;
}

function getAuthCallbackUrl(origin: string, next?: string): string | null {
  const trimmedOrigin = origin.trim().replace(/\/+$/, "");
  if (!trimmedOrigin) {
    return null;
  }
  const base = `${trimmedOrigin}/auth/callback`;
  const url =
    !next || next === "/" ? base : `${base}?next=${encodeURIComponent(next)}`;
  return isAbsoluteHttpUrl(url) ? url : null;
}

function resolveNextRedirect(nextRaw: string | null, origin: string): string {
  const isRelativeNext =
    !!nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//");
  return origin || isRelativeNext
    ? sanitizeRedirectPath(nextRaw, origin || "http://localhost")
    : "/";
}

export async function signInWithPassword(formData: FormData) {
  const email = getFormString(formData, "email");
  const password = getFormString(formData, "password");
  const origin = await getRequestOrigin();
  const next = resolveNextRedirect(
    getFormString(formData, "next") || null,
    origin
  );
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(
      loginRedirectUrl(
        {
          error:
            "No se pudo iniciar sesión. Verifica tu correo electrónico y contraseña.",
        },
        next
      )
    );
  }

  if (isInviteRedirectPath(next)) {
    redirect(next);
  }

  try {
    await ensureUserTenantContext();
  } catch (err) {
    console.error("[auth] Failed to prepare account after sign-in", err);
    redirect(
      loginRedirectUrl({ error: ACCOUNT_PREPARATION_ERROR_MESSAGE }, next)
    );
  }

  redirect(next);
}

export async function signUpWithPassword(formData: FormData) {
  const email = getFormString(formData, "email").trim();
  const password = getFormString(formData, "password");
  const confirmPassword = getFormString(formData, "confirmPassword");
  const displayName = getFormString(formData, "displayName").trim();
  const acceptedTerms = formData.get("terms") === "on";
  const origin = await getRequestOrigin();
  const next = resolveNextRedirect(
    getFormString(formData, "next") || null,
    origin
  );
  const callbackUrl = origin ? getAuthCallbackUrl(origin, next) : null;

  if (displayName.length < 2) {
    redirect(
      loginRedirectUrl(
        { error: "Escribe tu nombre completo para crear la cuenta." },
        next,
        "signup"
      )
    );
  }
  if (password.length < 8) {
    redirect(
      loginRedirectUrl(
        { error: "La contraseña debe tener al menos 8 caracteres." },
        next,
        "signup"
      )
    );
  }
  if (password !== confirmPassword) {
    redirect(
      loginRedirectUrl(
        { error: "Las contraseñas no coinciden." },
        next,
        "signup"
      )
    );
  }
  if (!acceptedTerms) {
    redirect(
      loginRedirectUrl(
        { error: "Debes aceptar los términos para crear la cuenta." },
        next,
        "signup"
      )
    );
  }
  if (!callbackUrl) {
    redirect(
      loginRedirectUrl(
        { error: INVITE_ORIGIN_UNAVAILABLE_MESSAGE },
        next,
        "signup"
      )
    );
  }
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: callbackUrl,
      data: {
        display_name: displayName,
      },
    },
  });

  if (error) {
    redirect(
      loginRedirectUrl(
        {
          error:
            "No se pudo crear la cuenta. Revisa los datos e inténtalo de nuevo.",
        },
        next,
        "signup"
      )
    );
  }

  if (!data.session) {
    redirect(
      loginRedirectUrl(
        {
          message:
            "Cuenta creada. Revisa tu correo electrónico para confirmarla y luego inicia sesión.",
        },
        next
      )
    );
  }

  if (isInviteRedirectPath(next)) {
    redirect(next);
  }

  try {
    await ensureUserTenantContext();
  } catch (err) {
    console.error("[auth] Failed to prepare account after sign-up", err);
    redirect(
      loginRedirectUrl({ error: ACCOUNT_PREPARATION_ERROR_MESSAGE }, next)
    );
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
