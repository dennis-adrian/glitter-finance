"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/app/auth/actions";
import {
  AuthField,
  AuthFormError,
  authInputClassName,
  authLinkClassName,
  AuthSubmitButton,
} from "@/components/molecules/auth-form-fields";
import {
  CaptchaWidget,
  useCaptcha,
} from "@/components/molecules/captcha-field";
import { Input } from "@/components/ui/input";
import { CAPTCHA_ACTIONS } from "@/lib/auth/captcha";

type PasswordResetRequestFormProps = {
  next: string;
  signInHref: string;
};

export function PasswordResetRequestForm({
  next,
  signInHref,
}: PasswordResetRequestFormProps) {
  const [state, action] = useActionState(requestPasswordReset, {
    error: null,
  });
  const [email, setEmail] = useState("");
  const captcha = useCaptcha(CAPTCHA_ACTIONS.reset);
  const formError = captcha.error ?? state.error;

  return (
    <form
      action={action}
      onSubmit={captcha.checkBeforeSubmit}
      className="flex flex-1 flex-col"
    >
      <input type="hidden" name="next" value={next} />

      {formError ? <AuthFormError>{formError}</AuthFormError> : null}

      <p className="pb-5 text-sm leading-snug text-foreground/70">
        Escribí el correo de tu cuenta y te enviamos un enlace para crear una
        contraseña nueva.
      </p>

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

      <CaptchaWidget captcha={captcha} className="pt-5" />

      <div className="pt-8">
        <AuthSubmitButton label="Enviar enlace" pendingLabel="Enviando…" />
      </div>

      <p className="pt-6 text-center text-sm text-foreground/70">
        ¿Te acordaste?{" "}
        <Link href={signInHref} className={authLinkClassName}>
          Iniciá sesión
        </Link>
      </p>
    </form>
  );
}
