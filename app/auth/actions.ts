"use server";

import { redirect } from "next/navigation";
import {
  isInviteRedirectPath,
  sanitizeRedirectPath,
} from "@/lib/auth/redirect";
import {
  getSignUpErrorMessage,
  SIGN_UP_TEMPORARY_ERROR_MESSAGE,
} from "@/lib/auth/signup-error";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import {
  INVITE_ORIGIN_UNAVAILABLE_MESSAGE,
  isAbsoluteHttpUrl,
} from "@/lib/invitations/validation";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

const ACCOUNT_PREPARATION_ERROR_MESSAGE = "No se pudo preparar la cuenta.";

export type SignUpState = {
  error: string | null;
};

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

// Build a /login redirect that preserves the sanitized `next` so an auth flow
// can still hand off to an invite or other deep link once the user succeeds.
function loginRedirectUrl(
  params: { error?: string; message?: string },
  next: string
): string {
  const search = new URLSearchParams();
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

export async function signUpWithPassword(
  _previousState: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const email = getFormString(formData, "email").trim();
  const password = getFormString(formData, "password");
  const confirmPassword = getFormString(formData, "confirmPassword");
  const displayName = getFormString(formData, "displayName").trim();
  const origin = await getRequestOrigin();
  const next = resolveNextRedirect(
    getFormString(formData, "next") || null,
    origin
  );
  const callbackUrl = origin ? getAuthCallbackUrl(origin, next) : null;

  if (displayName.length < 2) {
    return { error: "Escribe tu nombre completo para crear la cuenta." };
  }
  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres." };
  }
  if (password !== confirmPassword) {
    return { error: "Las contraseñas no coinciden." };
  }
  if (!callbackUrl) {
    return { error: INVITE_ORIGIN_UNAVAILABLE_MESSAGE };
  }
  const signUpResult = await (async () => {
    try {
      const supabase = await createClient();
      return await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: callbackUrl,
          data: {
            display_name: displayName,
          },
        },
      });
    } catch (err) {
      console.error("[auth] Failed to create account", err);
      return null;
    }
  })();

  if (!signUpResult) {
    return { error: SIGN_UP_TEMPORARY_ERROR_MESSAGE };
  }

  const { data, error } = signUpResult;

  if (error) {
    console.error("[auth] Supabase rejected sign-up", {
      code: error.code ?? null,
      name: error.name,
      status: error.status ?? null,
    });
    return { error: getSignUpErrorMessage(error) };
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
