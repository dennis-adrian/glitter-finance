import { NextResponse, type NextRequest } from "next/server";
import type { AuthError } from "@supabase/supabase-js";
import {
  type EmailLinkType,
  parseEmailLinkType,
  resolveEmailLinkDestination,
  resolveEmailLinkNext,
} from "@/lib/auth/email-link";
import { buildLoginRedirectPath } from "@/lib/auth/oauth";
import { skipPasswordForm } from "@/lib/auth/password-reset";
import { createClient } from "@/lib/supabase/server";
import { createSessionlessClient } from "@/lib/supabase/sessionless";

function logAuthError(message: string, error: AuthError) {
  console.error(message, {
    code: error.code ?? null,
    name: error.name,
    status: error.status ?? null,
  });
}

/**
 * Checks the link's token. Only a recovery link keeps its session, in this
 * browser's cookies. A confirmation link is checked with a client that keeps
 * the session to itself, so the browser stays signed in (or out) as it was;
 * see resolveEmailLinkDestination for why.
 */
async function verifyEmailLink(
  type: EmailLinkType,
  tokenHash: string
): Promise<boolean> {
  const keepsSession = type === "recovery";
  const supabase = keepsSession
    ? await createClient()
    : createSessionlessClient();
  const { data, error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });
  if (error) {
    logAuthError("Auth confirm: verifyOtp failed", error);
    return false;
  }

  // Nothing will use this session. Revoking it only tidies up, so a failure
  // does not undo the confirmation.
  if (!keepsSession && data.session) {
    const revoked = await supabase.auth
      .signOut({ scope: "local" })
      .catch((signOutError: unknown) => {
        console.error("Auth confirm: signOut failed", signOutError);
        return null;
      });
    if (revoked?.error) {
      logAuthError("Auth confirm: signOut failed", revoked.error);
    }
  }
  return true;
}

// Email links (see lib/auth/email-link.ts). /auth/callback stays for OAuth,
// whose code exchange needs the verifier cookie of the browser that started
// it.
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = parseEmailLinkType(requestUrl.searchParams.get("type"));
  const next = resolveEmailLinkNext(
    requestUrl.searchParams.get("next"),
    requestUrl.origin
  );
  // A failed recovery link opens the reset screen again, to ask for a new
  // email. A recovery link's next is the password form; /login gets the
  // page after it.
  const errorUrl = new URL(
    buildLoginRedirectPath(
      type === "recovery"
        ? { error: "password_reset_link_invalid", mode: "reset" }
        : { error: "email_link_invalid" },
      skipPasswordForm(next, requestUrl.origin)
    ),
    requestUrl.origin
  );

  if (!tokenHash || !type) {
    return NextResponse.redirect(errorUrl);
  }

  try {
    if (!(await verifyEmailLink(type, tokenHash))) {
      return NextResponse.redirect(errorUrl);
    }
  } catch (error) {
    console.error("Auth confirm: verification failed", error);
    return NextResponse.redirect(errorUrl);
  }

  return NextResponse.redirect(
    new URL(
      resolveEmailLinkDestination(type, next, requestUrl.origin),
      requestUrl.origin
    )
  );
}
