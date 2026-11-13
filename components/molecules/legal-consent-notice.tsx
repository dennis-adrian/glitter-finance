import { authLinkClassName } from "@/components/molecules/auth-form-fields";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal/paths";

/**
 * The sign-up form's consent line. It covers both ways to sign up on that
 * screen, the form and Google. The links open in a new tab so a half-filled
 * form is not lost.
 */
export function LegalConsentNotice() {
  return (
    <p className="text-center text-xs leading-snug text-foreground/70">
      Al crear tu cuenta, con tu correo o con Google, aceptás los{" "}
      <a
        href={TERMS_PATH}
        target="_blank"
        rel="noreferrer"
        className={authLinkClassName}
      >
        Términos y condiciones
      </a>{" "}
      y la{" "}
      <a
        href={PRIVACY_PATH}
        target="_blank"
        rel="noreferrer"
        className={authLinkClassName}
      >
        Política de privacidad
      </a>
      .
    </p>
  );
}
