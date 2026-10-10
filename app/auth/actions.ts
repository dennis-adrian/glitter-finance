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
import { LOGIN_ERROR_MESSAGES } from "@/lib/auth/login-messages";
import { newPasswordError } from "@/lib/auth/password";
import {
  buildUpdatePasswordPath,
  getPasswordUpdateErrorMessage,
  isPasswordResetSessionError,
  PASSWORD_RESET_ORIGIN_UNAVAILABLE_MESSAGE,
  resolvePasswordUpdateNext,
} from "@/lib/auth/password-reset";
import { ensureUserTenantContext } from "@/lib/auth/user-context";
import { isAbsoluteHttpUrl } from "@/lib/invitations/validation";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

/** What the sign-in, sign-up and password forms show after submitting. */
export type AuthFormState = {
  error: string | null;
};

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function signInWithPassword(
  _previousState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
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
        "No se pudo iniciar sesión. Verificá tu correo electrónico y contraseña.",
    };
  }

  if (isInviteRedirectPath(next)) {
    redirect(next);
  }

  try {
    await ensureUserTenantContext();
  } catch (err) {
    console.error("[auth] Failed to prepare account after sign-in", err);
    return { error: LOGIN_ERROR_MESSAGES.account_preparation_failed };
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
      buildLoginRedirectPath({ error: "google_origin_unavailable" }, next)
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
    redirect(buildLoginRedirectPath({ error: "google_sign_in_failed" }, next));
  }

  redirect(signInResult.data.url);
}

export async function signUpWithPassword(
  _previousState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
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
    return { error: "Escribí tu nombre completo para crear la cuenta." };
  }
  const passwordError = newPasswordError(password, confirmPassword);
  if (passwordError) {
    return { error: passwordError };
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
    redirect(buildLoginRedirectPath({ message: "signup_check_email" }, next));
  }

  if (isInviteRedirectPath(next)) {
    redirect(next);
  }

  try {
    await ensureUserTenantContext();
  } catch (err) {
    console.error("[auth] Failed to prepare account after sign-up", err);
    redirect(
      buildLoginRedirectPath({ error: "account_preparation_failed" }, next)
    );
  }

  redirect(next);
}

/**
 * Sends the password recovery email. The user sees the same message
 * whatever Supabase answers: it stays silent for an email without an
 * account but can rate-limit or fail to send only for a real one, so any
 * difference would tell which emails have an account.
 */
export async function requestPasswordReset(
  _previousState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = getFormString(formData, "email").trim();
  const origin = await getRequestOrigin();
  const next = resolveAuthRedirectPath(
    getFormString(formData, "next") || null,
    origin
  );
  // The callback URL, as for sign-up: the hosted redirect allow lists accept
  // it, and the recovery email passes it back as `next` (see
  // lib/auth/email-link.ts), which leads to the password form.
  const redirectTo = origin
    ? buildAuthCallbackUrl(origin, buildUpdatePasswordPath(next))
    : null;

  if (!email) {
    return { error: "Ingresá tu correo electrónico." };
  }
  if (!redirectTo) {
    return { error: PASSWORD_RESET_ORIGIN_UNAVAILABLE_MESSAGE };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) {
      console.error("[auth] Supabase rejected a password reset request", {
        code: error.code ?? null,
        name: error.name,
        status: error.status ?? null,
      });
    }
  } catch (err) {
    console.error("[auth] Failed to request a password reset", err);
  }

  redirect(
    buildLoginRedirectPath({ message: "password_reset_requested" }, next)
  );
}

/**
 * Sets a new password for the signed-in user: the session the recovery
 * link opened (app/auth/confirm), or any other one.
 */
export async function updatePassword(
  _previousState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const password = getFormString(formData, "password");
  const confirmPassword = getFormString(formData, "confirmPassword");
  const origin = await getRequestOrigin();
  const next = resolvePasswordUpdateNext(
    getFormString(formData, "next") || null,
    origin
  );

  const passwordError = newPasswordError(password, confirmPassword);
  if (passwordError) {
    return { error: passwordError };
  }

  const updateResult = await (async () => {
    try {
      const supabase = await createClient();
      return await supabase.auth.updateUser({ password });
    } catch (err) {
      console.error("[auth] Failed to update the password", err);
      return null;
    }
  })();

  if (!updateResult) {
    return {
      error:
        "No se pudo conectar con el servicio de inicio de sesión. Intentá de nuevo.",
    };
  }

  const { error } = updateResult;

  if (error) {
    console.error("[auth] Supabase rejected the password update", {
      code: error.code ?? null,
      name: error.name,
      status: error.status ?? null,
    });
    if (isPasswordResetSessionError(error)) {
      redirect(
        buildLoginRedirectPath(
          { error: "password_reset_link_invalid", mode: "reset" },
          next
        )
      );
    }
    return { error: getPasswordUpdateErrorMessage(error) };
  }

  redirect(next);
}

/**
 * Ends this device's session. It does not redirect: the client runs it only
 * after the local teardown and then loads /login itself, so a failure here
 * (offline, auth outage) stays a normal error it can show and retry, instead
 * of looking like the NEXT_REDIRECT rejection a redirect would produce.
 *
 * Scope "local" revokes only this session. The default ("global") would also
 * sign out the user's other devices, which could then not upload their
 * queued sales until someone signs in there again.
 */
export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    console.error("[auth] Failed to sign out", {
      code: error.code ?? null,
      name: error.name,
      status: error.status ?? null,
    });
    // supabase-js keeps the session when the revocation fails for any
    // reason other than an already-invalid session.
    throw new Error("No se pudo cerrar la sesión.");
  }
}
