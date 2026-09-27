"use client";

import { useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORDS_DO_NOT_MATCH_MESSAGE,
} from "@/lib/auth/password";
import { cn } from "@/lib/utils";

// Building blocks shared by the sign-in, sign-up and password reset forms.

export const authInputClassName =
  "h-12! rounded-xl! border-[#e2dcd5] bg-white px-4 text-sm text-[#1e2d2b] shadow-none placeholder:text-[#5a6b68] focus-visible:border-[#00786f] focus-visible:ring-[#00786f]/15";

export const authLinkClassName =
  "font-bold text-[#00786f] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#00786f]/40";

export function PasswordInput({
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
        className={cn(authInputClassName, "pr-23")}
      />
      <button
        type="button"
        onClick={() => setIsVisible((visible) => !visible)}
        aria-label={isVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={isVisible}
        className="absolute inset-y-0 right-0 min-w-20.5 rounded-r-xl px-4 text-right text-[13px] font-bold text-[#00786f] uppercase transition-colors hover:text-[#0d564f] focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-[#00786f]/40"
      >
        {isVisible ? "Ocultar" : "Mostrar"}
      </button>
    </div>
  );
}

export function AuthSubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-13! w-full rounded-2xl! border-0 bg-[#00786f] text-base font-bold text-white shadow-[0_4px_6px_rgba(0,120,111,0.15)] hover:bg-[#0d564f] disabled:bg-[#b4c2bf] disabled:text-white disabled:opacity-100 disabled:shadow-none"
    >
      {pending ? (
        <>
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

export function AuthField({
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

export function AuthFormError({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      role="alert"
      className="mb-4 rounded-xl border border-[#e8725a]/35 bg-[#fdf0ed] px-4 py-3 text-sm leading-snug text-[#8a3329]"
    >
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
  if (password.length >= MIN_PASSWORD_LENGTH && variety >= 2) return 3;
  if (password.length >= MIN_PASSWORD_LENGTH) return 2;
  return 1;
}

function strengthLabel(strength: number) {
  if (strength === 0) return `Usá al menos ${MIN_PASSWORD_LENGTH} caracteres`;
  if (strength === 1) return "Contraseña débil";
  if (strength === 2) return "Contraseña media";
  return "Contraseña fuerte";
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const strength = useMemo(() => passwordStrength(password), [password]);

  return (
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
  );
}

export const AUTH_FORM_ERROR_ID = "auth-form-error";

/**
 * State for a new password and its confirmation (sign-up, password reset).
 * checkBeforeSubmit stops a submit whose two passwords differ before it
 * reaches the server; the server action checks again.
 */
export function useNewPasswordConfirmation() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatchError, setMismatchError] = useState<string | null>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  function checkBeforeSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    if (formData.get("password") === formData.get("confirmPassword")) {
      setMismatchError(null);
      return;
    }

    event.preventDefault();
    setMismatchError(PASSWORDS_DO_NOT_MATCH_MESSAGE);
    confirmPasswordRef.current?.focus();
  }

  function changePassword(value: string) {
    setPassword(value);
    if (value === confirmPassword) setMismatchError(null);
  }

  function changeConfirmPassword(value: string) {
    setConfirmPassword(value);
    if (value === password) setMismatchError(null);
  }

  return {
    password,
    confirmPassword,
    mismatchError,
    confirmPasswordRef,
    checkBeforeSubmit,
    changePassword,
    changeConfirmPassword,
  };
}

export function ConfirmPasswordInput({
  ref,
  value,
  invalid,
  onChange,
}: {
  ref: React.Ref<HTMLInputElement>;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      id="confirmPassword"
      name="confirmPassword"
      type="password"
      autoComplete="new-password"
      placeholder="Repetí tu contraseña"
      minLength={MIN_PASSWORD_LENGTH}
      value={value}
      required
      ref={ref}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={invalid ? AUTH_FORM_ERROR_ID : undefined}
      onChange={(event) => onChange(event.currentTarget.value)}
      className={authInputClassName}
    />
  );
}
