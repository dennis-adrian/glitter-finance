"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  isInviteRedirectPath,
  sanitizeRedirectPath,
} from "@/lib/auth/redirect";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import { createClient } from "@/lib/supabase/server";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function getRequestOrigin() {
  const headerStore = await headers();
  return (
    headerStore.get("origin") ??
    `https://${headerStore.get("x-forwarded-host") ?? headerStore.get("host")}`
  );
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
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  if (isInviteRedirectPath(next)) {
    redirect(next);
  }

  try {
    await ensureUserTenantContext();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unable to initialize account.";
    redirect(`/login?error=${encodeURIComponent(message)}`);
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
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  if (!data.session) {
    const loginParams = new URLSearchParams({
      message:
        "Cuenta creada. Revisa tu email para confirmar tu cuenta y luego inicia sesión.",
    });
    if (next !== "/") {
      loginParams.set("next", next);
    }
    redirect(`/login?${loginParams.toString()}`);
  }

  if (isInviteRedirectPath(next)) {
    redirect(next);
  }

  try {
    await ensureUserTenantContext();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unable to initialize account.";
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
