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

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

// Build a /login redirect that preserves the sanitized `next` so a failed
// attempt (bad credentials, bootstrap error) still hands off to the invite or
// other deep-link flow once the user succeeds.
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
    !next || next === "/"
      ? base
      : `${base}?next=${encodeURIComponent(next)}`;
  return isAbsoluteHttpUrl(url) ? url : null;
}

export async function signInWithPassword(formData: FormData) {
  const email = getFormString(formData, "email");
  const password = getFormString(formData, "password");
  const origin = await getRequestOrigin();
  const next = origin
    ? sanitizeRedirectPath(getFormString(formData, "next") || null, origin)
    : "/";
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(loginRedirectUrl({ error: error.message }, next));
  }

  if (isInviteRedirectPath(next)) {
    redirect(next);
  }

  try {
    await ensureUserTenantContext();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unable to initialize account.";
    redirect(loginRedirectUrl({ error: message }, next));
  }

  redirect(next);
}

export async function signUpWithPassword(formData: FormData) {
  const email = getFormString(formData, "email");
  const password = getFormString(formData, "password");
  const displayName = getFormString(formData, "displayName") || email;
  const origin = await getRequestOrigin();
  const next = origin
    ? sanitizeRedirectPath(getFormString(formData, "next") || null, origin)
    : "/";
  const callbackUrl = origin ? getAuthCallbackUrl(origin, next) : null;
  if (!callbackUrl) {
    redirect(
      loginRedirectUrl({ error: INVITE_ORIGIN_UNAVAILABLE_MESSAGE }, "/")
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
    redirect(loginRedirectUrl({ error: error.message }, next));
  }

  if (!data.session) {
    redirect(
      loginRedirectUrl(
        {
          message:
            "Cuenta creada. Revisa tu email para confirmar tu cuenta y luego inicia sesión.",
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
    const message =
      err instanceof Error ? err.message : "Unable to initialize account.";
    redirect(loginRedirectUrl({ error: message }, next));
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
