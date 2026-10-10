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
import { Input } from "@/components/ui/input";

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

  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="next" value={next} />

      {state.error ? <AuthFormError>{state.error}</AuthFormError> : null}

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
