"use server";

import { redirect } from "next/navigation";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import { createClient } from "@/lib/supabase/server";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
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

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
      },
    },
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

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
