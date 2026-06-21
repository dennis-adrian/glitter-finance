"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import { createClient } from "@/lib/supabase/server";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function getAuthCallbackUrl() {
  const headerStore = await headers();
  const origin =
    headerStore.get("origin") ??
    `https://${headerStore.get("x-forwarded-host") ?? headerStore.get("host")}`;

  return `${origin}/auth/callback`;
}

export async function signInWithPassword(formData: FormData) {
  const email = getFormString(formData, "email");
  const password = getFormString(formData, "password");
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  try {
    await ensureUserTenantContext();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unable to initialize account.";
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }

  redirect("/");
}

export async function signUpWithPassword(formData: FormData) {
  const email = getFormString(formData, "email");
  const password = getFormString(formData, "password");
  const displayName = getFormString(formData, "displayName") || email;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: await getAuthCallbackUrl(),
      data: {
        display_name: displayName,
      },
    },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  if (!data.session) {
    redirect(
      `/login?message=${encodeURIComponent("Cuenta creada. Revisa tu email para confirmar tu cuenta y luego inicia sesión.")}`
    );
  }

  try {
    await ensureUserTenantContext();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unable to initialize account.";
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
