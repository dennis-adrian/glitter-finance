"use server";

import { redirect } from "next/navigation";
import { isInviteRedirectPath } from "@/lib/auth/redirect";
import {
  buildAuthCallbackUrl,
  buildLoginRedirectPath,
  resolveAuthRedirectPath,
} from "@/lib/auth/oauth";
import {
  getSignUpErrorMessage,
  SIGN_UP_ORIGIN_UNAVAILABLE_MESSAGE,
  SIGN_UP_TEMPORARY_ERROR_MESSAGE,
} from "@/lib/auth/signup-error";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import { isAbsoluteHttpUrl } from "@/lib/invitations/validation";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

const ACCOUNT_PREPARATION_ERROR_MESSAGE = "No se pudo preparar la cuenta.";
const GOOGLE_SIGN_IN_ERROR_MESSAGE =
  "No se pudo iniciar sesión con Google. Intentá de nuevo.";
const GOOGLE_SIGN_IN_ORIGIN_ERROR_MESSAGE =
  "No se pudo determinar la URL de la app para iniciar sesión con Google.";

export type SignUpState = {
  error: string | null;
};

export type SignInState = {
  error: string | null;
};

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function signInWithPassword(
  _previousState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = getFormString(formData, "email");
  const password = getFormString(formData, "password");
  const origin = await getRequestOrigin();
  const next = resolveAuthRedirectPath(
    getFormString(formData, "next") || null,
    origin
  );
  const signInResult = await (async () => {
    try {
      const supabase = await createClient();
      return await supabase.auth.signInWithPassword({ email, password });
    } catch (err) {
      console.error("[auth] Failed to sign in", err);
      return null;
    }
  })();

  if (!signInResult) {
    return {
      error:
        "No se pudo conectar con el servicio de inicio de sesión. Intentá de nuevo.",
    };
  }

  const { error } = signInResult;

  if (error) {
    return {
      error:
        "No se pudo iniciar sesión. Verifica tu correo electrónico y contraseña.",
    };
  }

  if (isInviteRedirectPath(next)) {
    redirect(next);
  }

  try {
    await ensureUserTenantContext();
  } catch (err) {
    console.error("[auth] Failed to prepare account after sign-in", err);
    return { error: ACCOUNT_PREPARATION_ERROR_MESSAGE };
  }

  redirect(next);
}

export async function signInWithGoogle(formData: FormData) {
  const origin = await getRequestOrigin();
  const next = resolveAuthRedirectPath(
    getFormString(formData, "next") || null,
    origin
  );
  const callbackUrl = origin ? buildAuthCallbackUrl(origin, next) : null;

  if (!callbackUrl) {
    redirect(
      buildLoginRedirectPath(
        { error: GOOGLE_SIGN_IN_ORIGIN_ERROR_MESSAGE },
        next
      )
    );
  }

  const signInResult = await (async () => {
    try {
      const supabase = await createClient();
      return await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl },
      });
    } catch (error) {
      console.error("[auth] Failed to start Google sign-in", error);
      return null;
    }
  })();

  if (
    !signInResult ||
    signInResult.error ||
    !signInResult.data.url ||
    !isAbsoluteHttpUrl(signInResult.data.url)
  ) {
    if (signInResult?.error) {
      console.error("[auth] Supabase rejected Google sign-in", {
        code: signInResult.error.code ?? null,
        name: signInResult.error.name,
        status: signInResult.error.status ?? null,
      });
    }
    redirect(
      buildLoginRedirectPath({ error: GOOGLE_SIGN_IN_ERROR_MESSAGE }, next)
    );
  }

  redirect(signInResult.data.url);
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
  const next = resolveAuthRedirectPath(
    getFormString(formData, "next") || null,
    origin
  );
  const callbackUrl = origin ? buildAuthCallbackUrl(origin, next) : null;

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
    return { error: SIGN_UP_ORIGIN_UNAVAILABLE_MESSAGE };
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
      buildLoginRedirectPath(
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
      buildLoginRedirectPath({ error: ACCOUNT_PREPARATION_ERROR_MESSAGE }, next)
    );
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
