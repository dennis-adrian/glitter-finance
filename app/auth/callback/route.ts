import { NextResponse, type NextRequest } from "next/server";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const safeNext = sanitizeRedirectPath(
    requestUrl.searchParams.get("next"),
    requestUrl.origin
  );

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error(
          "Auth callback: exchangeCodeForSession failed",
          error.message
        );
        return NextResponse.redirect(new URL("/", requestUrl.origin));
      }
    } catch (error) {
      console.error("Auth callback: session exchange failed", error);
      return NextResponse.redirect(new URL("/", requestUrl.origin));
    }
  }

  return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
}
