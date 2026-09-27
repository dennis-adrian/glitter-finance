import { NextResponse, type NextRequest } from "next/server";
import {
  parseEmailLinkType,
  resolveEmailLinkDestination,
  resolveEmailLinkNext,
} from "@/lib/auth/email-link";
import { buildLoginRedirectPath } from "@/lib/auth/oauth";
import { createClient } from "@/lib/supabase/server";

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
  // A failed recovery link opens the reset form again, to ask for a new
  // email.
  const errorUrl = new URL(
    buildLoginRedirectPath(
      type === "recovery"
        ? { error: "password_reset_link_invalid", mode: "reset" }
        : { error: "email_link_invalid" },
      next
    ),
    requestUrl.origin
  );

  if (!tokenHash || !type) {
    return NextResponse.redirect(errorUrl);
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (error) {
      console.error("Auth confirm: verifyOtp failed", {
        code: error.code ?? null,
        name: error.name,
        status: error.status ?? null,
      });
      return NextResponse.redirect(errorUrl);
    }
  } catch (error) {
    console.error("Auth confirm: verification failed", error);
    return NextResponse.redirect(errorUrl);
  }

  return NextResponse.redirect(
    new URL(resolveEmailLinkDestination(type, next), requestUrl.origin)
  );
}
