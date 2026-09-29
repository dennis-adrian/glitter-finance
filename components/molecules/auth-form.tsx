"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
} from "@/app/auth/actions";
import {
  AUTH_FORM_ERROR_ID,
  AuthField,
  AuthFormError,
  authInputClassName,
  authLinkClassName,
  AuthSubmitButton,
  ConfirmPasswordInput,
  PasswordInput,
  PasswordStrengthMeter,
  useNewPasswordConfirmation,
} from "@/components/molecules/auth-form-fields";
import { GoogleSubmitButton } from "@/components/molecules/google-sign-in-button";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { cn } from "@/lib/utils";

type AuthMode = "signin" | "signup";

type AuthFormProps = {
  mode: AuthMode;
  next: string;
  alternateHref: string;
  passwordResetHref: string;
};

function SubmitButton({ mode }: { mode: AuthMode }) {
  return mode === "signin" ? (
    <AuthSubmitButton label="Entrar" pendingLabel="Entrando…" />
  ) : (
    <AuthSubmitButton label="Registrarme" pendingLabel="Creando cuenta…" />
  );
}

export function AuthForm({
  mode,
  next,
  alternateHref,
  passwordResetHref,
}: AuthFormProps) {
  const [signInState, signInAction] = useActionState(signInWithPassword, {
    error: null,
  });
  const [signUpState, signUpAction] = useActionState(signUpWithPassword, {
    error: null,
  });
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const {
    password,
    confirmPassword,
    mismatchError,
    confirmPasswordRef,
    checkBeforeSubmit,
    changePassword,
    changeConfirmPassword,
  } = useNewPasswordConfirmation();
  const isSignup = mode === "signup";
  const formError = isSignup
    ? (mismatchError ?? signUpState.error)
    : signInState.error;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (isSignup) checkBeforeSubmit(event);
  }

  return (
    <div className="flex flex-1 flex-col">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <GoogleSubmitButton />
      </form>

      <div className="flex items-center gap-3 py-5" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-semibold text-foreground/60">o</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form
        action={isSignup ? signUpAction : signInAction}
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col"
      >
        <input type="hidden" name="next" value={next} />

        {formError ? (
          <AuthFormError id={AUTH_FORM_ERROR_ID}>{formError}</AuthFormError>
        ) : null}

        <div className={cn("grid", isSignup ? "gap-3.5" : "gap-4")}>
          {isSignup ? (
            <AuthField id="displayName" label="Nombre completo">
              <Input
                id="displayName"
                name="displayName"
                autoComplete="name"
                placeholder="Ej. María Pérez"
                minLength={2}
                value={displayName}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
                required
                className={authInputClassName}
              />
            </AuthField>
          ) : null}

          <AuthField id="email" label="Correo electrónico">
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="nombre@correo.com"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
              className={authInputClassName}
            />
          </AuthField>

          <AuthField id="password" label="Contraseña">
            <PasswordInput
              id="password"
              name="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder={isSignup ? "Creá una contraseña" : "Tu contraseña"}
              minLength={isSignup ? MIN_PASSWORD_LENGTH : undefined}
              value={password}
              onChange={(event) => changePassword(event.currentTarget.value)}
            />
            {isSignup ? <PasswordStrengthMeter password={password} /> : null}
          </AuthField>

          {isSignup ? (
            <AuthField id="confirmPassword" label="Confirmar contraseña">
              <ConfirmPasswordInput
                ref={confirmPasswordRef}
                value={confirmPassword}
                invalid={mismatchError !== null}
                onChange={changeConfirmPassword}
              />
            </AuthField>
          ) : (
            <Link
              href={passwordResetHref}
              className={cn("justify-self-end text-sm", authLinkClassName)}
            >
              ¿Olvidaste tu contraseña?
            </Link>
          )}
        </div>

        {isSignup ? (
          <div className="grid gap-4 pt-6">
            <SubmitButton mode={mode} />
            <p className="text-center text-sm text-foreground/70">
              ¿Ya tenés una cuenta?{" "}
              <Link href={alternateHref} className={authLinkClassName}>
                Iniciá Sesión
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="pt-8">
              <SubmitButton mode={mode} />
            </div>

            <p className="pt-6 text-center text-sm text-foreground/70">
              ¿No tenés cuenta?{" "}
              <Link href={alternateHref} className={authLinkClassName}>
                Registrate
              </Link>
            </p>
          </>
        )}
      </form>
    </div>
  );
}
