import { NextResponse, type NextRequest } from "next/server";
import { isAuthPKCECodeVerifierMissingError } from "@supabase/supabase-js";
import type { LoginErrorCode } from "@/lib/auth/login-messages";
import { buildLoginRedirectPath } from "@/lib/auth/oauth";
import {
  isUpdatePasswordPath,
  skipPasswordForm,
} from "@/lib/auth/password-reset";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

function authErrorUrl(
  requestUrl: URL,
  next: string,
  error: LoginErrorCode = "auth_callback_failed"
) {
  // A recovery email that still uses {{ .ConfirmationURL }} comes through
  // here on its way to the password form. If it fails, the reset screen
  // asks for a new email.
  const params = isUpdatePasswordPath(next)
    ? ({ error: "password_reset_link_invalid", mode: "reset" } as const)
    : { error };
  return new URL(
    buildLoginRedirectPath(params, skipPasswordForm(next, requestUrl.origin)),
    requestUrl.origin
  );
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const safeNext = sanitizeRedirectPath(
    requestUrl.searchParams.get("next"),
    requestUrl.origin
  );

  const providerError = requestUrl.searchParams.get("error");
  if (providerError) {
    console.error("Auth callback: provider returned an error", {
      code: providerError,
    });
    return NextResponse.redirect(authErrorUrl(requestUrl, safeNext));
  }

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error(
          "Auth callback: exchangeCodeForSession failed",
          error.message
        );
        // Emails that still use Supabase's {{ .ConfirmationURL }} land here
        // with a code, and opened in another browser (the iOS PWA, an email
        // app) there is no verifier to exchange it with. Supabase confirmed
        // the address before redirecting, so password sign-in works.
        return NextResponse.redirect(
          authErrorUrl(
            requestUrl,
            safeNext,
            isAuthPKCECodeVerifierMissingError(error)
              ? "auth_link_other_browser"
              : "auth_callback_failed"
          )
        );
      }
    } catch (error) {
      console.error("Auth callback: session exchange failed", error);
      return NextResponse.redirect(authErrorUrl(requestUrl, safeNext));
    }
  }

  return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
}
