"use server";

import { redirect } from "next/navigation";
import {
  isInviteRedirectPath,
  sanitizeRedirectPath,
} from "@/lib/auth/redirect";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
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

async function getAuthCallbackUrl(next?: string) {
  const origin = await getRequestOrigin();
  const base = `${origin}/auth/callback`;
  if (!next || next === "/") {
    return base;
  }
  return `${base}?next=${encodeURIComponent(next)}`;
}

export async function signInWithPassword(formData: FormData) {
  const email = getFormString(formData, "email");
  const password = getFormString(formData, "password");
  const next = sanitizeRedirectPath(
    getFormString(formData, "next") || null,
    await getRequestOrigin()
  );
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
  const next = sanitizeRedirectPath(
    getFormString(formData, "next") || null,
    await getRequestOrigin()
  );
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: await getAuthCallbackUrl(next),
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
