"use client";

import { useActionState } from "react";
import { updatePassword } from "@/app/auth/actions";
import {
  AUTH_FORM_ERROR_ID,
  AuthField,
  AuthFormError,
  AuthSubmitButton,
  ConfirmPasswordInput,
  PasswordInput,
  PasswordStrengthMeter,
  useNewPasswordConfirmation,
} from "@/components/molecules/auth-form-fields";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

type UpdatePasswordFormProps = {
  next: string;
};

export function UpdatePasswordForm({ next }: UpdatePasswordFormProps) {
  const [state, action] = useActionState(updatePassword, { error: null });
  const {
    password,
    confirmPassword,
    mismatchError,
    confirmPasswordRef,
    checkBeforeSubmit,
    changePassword,
    changeConfirmPassword,
  } = useNewPasswordConfirmation();
  const formError = mismatchError ?? state.error;

  return (
    <form
      action={action}
      onSubmit={checkBeforeSubmit}
      className="flex flex-1 flex-col"
    >
      <input type="hidden" name="next" value={next} />

      {formError ? (
        <AuthFormError id={AUTH_FORM_ERROR_ID}>{formError}</AuthFormError>
      ) : null}

      <div className="grid gap-3.5">
        <AuthField id="password" label="Contraseña nueva">
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            placeholder="Creá una contraseña"
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => changePassword(event.currentTarget.value)}
          />
          <PasswordStrengthMeter password={password} />
        </AuthField>

        <AuthField id="confirmPassword" label="Confirmar contraseña">
          <ConfirmPasswordInput
            ref={confirmPasswordRef}
            value={confirmPassword}
            invalid={mismatchError !== null}
            onChange={changeConfirmPassword}
          />
        </AuthField>
      </div>

      <div className="pt-8">
        <AuthSubmitButton
          label="Guardar contraseña"
          pendingLabel="Guardando…"
        />
      </div>
    </form>
  );
}
