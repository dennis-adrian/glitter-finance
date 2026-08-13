"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { signInWithPassword, signUpWithPassword } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type AuthMode = "signin" | "signup";

type AuthFormProps = {
  mode: AuthMode;
  next: string;
  alternateHref: string;
};

const inputClassName =
  "h-12! rounded-xl! border-[#e2dcd5] bg-white px-4 text-sm text-[#1e2d2b] shadow-none placeholder:text-[#5a6b68] focus-visible:border-[#00786f] focus-visible:ring-[#00786f]/15";

function PasswordInput({
  id,
  name,
  autoComplete,
  placeholder,
  minLength,
  value,
  onChange,
}: {
  id: string;
  name: string;
  autoComplete: string;
  placeholder: string;
  minLength?: number;
  value: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={isVisible ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        value={value}
        required
        onChange={onChange}
        className={cn(inputClassName, "pr-[92px]")}
      />
      <button
        type="button"
        onClick={() => setIsVisible((visible) => !visible)}
        aria-label={isVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={isVisible}
        className="absolute inset-y-0 right-0 min-w-[82px] rounded-r-xl px-4 text-right text-[13px] font-bold text-[#00786f] uppercase transition-colors hover:text-[#0d564f] focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-[#00786f]/40"
      >
        {isVisible ? "Ocultar" : "Mostrar"}
      </button>
    </div>
  );
}

function SubmitButton({ mode }: { mode: AuthMode }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-[52px]! w-full rounded-2xl! border-0 bg-[#00786f] text-base font-bold text-white shadow-[0_4px_6px_rgba(0,120,111,0.15)] hover:bg-[#0d564f] disabled:bg-[#b4c2bf] disabled:text-white disabled:opacity-100 disabled:shadow-none"
    >
      {pending ? (
        <>
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {mode === "signin" ? "Entrando…" : "Creando cuenta…"}
        </>
      ) : mode === "signin" ? (
        "Entrar"
      ) : (
        "Registrarme"
      )}
    </Button>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-[13px] font-bold text-[#1e2d2b]">
        {label}
      </Label>
      {children}
    </div>
  );
}

function passwordStrength(password: string) {
  if (!password) return 0;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) =>
    rule.test(password)
  ).length;

  if (password.length >= 12 && variety >= 3) return 4;
  if (password.length >= 8 && variety >= 2) return 3;
  if (password.length >= 8) return 2;
  return 1;
}

function strengthLabel(strength: number) {
  if (strength === 0) return "Usá al menos 8 caracteres";
  if (strength === 1) return "Contraseña débil";
  if (strength === 2) return "Contraseña media";
  return "Contraseña fuerte";
}

export function AuthForm({ mode, next, alternateHref }: AuthFormProps) {
  const [signUpState, signUpAction] = useActionState(signUpWithPassword, {
    error: null,
  });
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const strength = useMemo(() => passwordStrength(password), [password]);
  const isSignup = mode === "signup";
  const formError = isSignup ? (passwordError ?? signUpState.error) : null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!isSignup) return;

    const formData = new FormData(event.currentTarget);
    if (formData.get("password") === formData.get("confirmPassword")) {
      setPasswordError(null);
      return;
    }

    event.preventDefault();
    setPasswordError("Las contraseñas no coinciden.");
    confirmPasswordRef.current?.focus();
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    if (value === confirmPassword) setPasswordError(null);
  }

  function handleConfirmPasswordChange(value: string) {
    setConfirmPassword(value);
    if (value === password) setPasswordError(null);
  }

  return (
    <form
      action={isSignup ? signUpAction : signInWithPassword}
      onSubmit={handleSubmit}
      className="flex flex-1 flex-col"
    >
      <input type="hidden" name="next" value={next} />

      {formError ? (
        <div
          id="auth-form-error"
          role="alert"
          className="mb-4 rounded-xl border border-[#e8725a]/35 bg-[#fdf0ed] px-4 py-3 text-sm leading-snug text-[#8a3329]"
        >
          {formError}
        </div>
      ) : null}

      <div className={cn("grid", isSignup ? "gap-3.5" : "gap-4")}>
        {isSignup ? (
          <Field id="displayName" label="Nombre completo">
            <Input
              id="displayName"
              name="displayName"
              autoComplete="name"
              placeholder="Ej. María Pérez"
              minLength={2}
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
              required
              className={inputClassName}
            />
          </Field>
        ) : null}

        <Field id="email" label="Correo electrónico">
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
            className={inputClassName}
          />
        </Field>

        <Field id="password" label="Contraseña">
          <PasswordInput
            id="password"
            name="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder={isSignup ? "Creá una contraseña" : "Tu contraseña"}
            minLength={isSignup ? 8 : undefined}
            value={password}
            onChange={(event) =>
              handlePasswordChange(event.currentTarget.value)
            }
          />
          {isSignup ? (
            <div className="grid gap-1 pt-0.5" aria-live="polite">
              <div className="grid grid-cols-4 gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map((level) => (
                  <span
                    key={level}
                    className={cn(
                      "h-1 rounded-sm transition-colors",
                      strength >= level ? "bg-[#4caf50]" : "bg-[#e2dcd5]/50"
                    )}
                  />
                ))}
              </div>
              <span
                className={cn(
                  "text-[11px]",
                  strength >= 3 ? "text-[#4caf50]" : "text-[#5a6b68]"
                )}
              >
                {strengthLabel(strength)}
              </span>
            </div>
          ) : null}
        </Field>

        {isSignup ? (
          <Field id="confirmPassword" label="Confirmar contraseña">
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Repetí tu contraseña"
              minLength={8}
              value={confirmPassword}
              required
              ref={confirmPasswordRef}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? "auth-form-error" : undefined}
              onChange={(event) =>
                handleConfirmPasswordChange(event.currentTarget.value)
              }
              className={inputClassName}
            />
          </Field>
        ) : (
          <button
            type="button"
            disabled
            title="Recuperación de contraseña próximamente"
            className="justify-self-end text-sm font-bold text-[#00786f] disabled:cursor-not-allowed"
          >
            ¿Olvidaste tu contraseña?
          </button>
        )}
      </div>

      {isSignup ? (
        <div className="grid gap-4 pt-6">
          <SubmitButton mode={mode} />
          <p className="text-center text-sm text-[#5a6b68]">
            ¿Ya tenés una cuenta?{" "}
            <Link
              href={alternateHref}
              className="font-bold text-[#00786f] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#00786f]/40"
            >
              Iniciá Sesión
            </Link>
          </p>
        </div>
      ) : (
        <>
          <div className="pt-8">
            <SubmitButton mode={mode} />
          </div>

          <p className="pt-6 text-center text-sm text-[#5a6b68]">
            ¿No tenés cuenta?{" "}
            <Link
              href={alternateHref}
              className="font-bold text-[#00786f] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#00786f]/40"
            >
              Registrate
            </Link>
          </p>
        </>
      )}
    </form>
  );
}
