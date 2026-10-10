// Password rules shared by sign-up and password reset, on the server and in
// the forms. Supabase Auth enforces the same minimum
// (`minimum_password_length` in supabase/config.toml and in each hosted
// project), so a sign-up or password change that skips these forms cannot
// set a shorter password either.
export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_TOO_SHORT_MESSAGE = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;

export const PASSWORDS_DO_NOT_MATCH_MESSAGE = "Las contraseñas no coinciden.";

/** The first rule a new password and its confirmation break, or null. */
export function newPasswordError(
  password: string,
  confirmPassword: string
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return PASSWORD_TOO_SHORT_MESSAGE;
  }
  if (password !== confirmPassword) {
    return PASSWORDS_DO_NOT_MATCH_MESSAGE;
  }
  return null;
}
