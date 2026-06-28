import { createHmac } from "crypto";
import { getServerEnv } from "@/lib/env";

export function hashInvitationToken(rawToken: string): string {
  const secret = getServerEnv().supabaseSecretKey;
  if (!secret) {
    throw new Error("Missing required environment variable: SUPABASE_SECRET_KEY");
  }
  return createHmac("sha256", secret).update(rawToken).digest("base64url");
}
