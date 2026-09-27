import { NextResponse, type NextRequest } from "next/server";
import {
  parseEmailLinkType,
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
  const errorUrl = new URL(
    buildLoginRedirectPath({ error: "email_link_invalid" }, next),
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

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
