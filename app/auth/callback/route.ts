import { NextResponse, type NextRequest } from "next/server";
import { buildLoginRedirectPath } from "@/lib/auth/oauth";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

const AUTH_CALLBACK_ERROR_MESSAGE =
  "No se pudo completar el inicio de sesión. Intentá de nuevo.";

function authErrorUrl(requestUrl: URL, next: string) {
  return new URL(
    buildLoginRedirectPath({ error: AUTH_CALLBACK_ERROR_MESSAGE }, next),
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
        return NextResponse.redirect(authErrorUrl(requestUrl, safeNext));
      }
    } catch (error) {
      console.error("Auth callback: session exchange failed", error);
      return NextResponse.redirect(authErrorUrl(requestUrl, safeNext));
    }
  }

  return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
}
