import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// The session refresh only matters for pages, their server actions and the
// auth routes. Skip it for the Sentry tunnel (monitoring), build output, the
// service worker (/serwist/sw.js), the PowerSync worker and WASM files copied
// into public/@powersync, the manifest, the health check, the offline page
// and static files. Server actions post to their page's path, so any page
// excluded here would also skip the refresh for its actions.
export const config = {
  matcher: [
    "/((?!monitoring|_next/static|_next/image|favicon.ico|serwist/|@powersync/|manifest.webmanifest|api/health|~offline|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|mjs|wasm|map)$).*)",
  ],
};
