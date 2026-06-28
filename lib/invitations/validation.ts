import type { TenantInvitation } from "@/lib/types";

// Pure invitation helpers safe to import from client components. Keep this
// module free of server-only dependencies (db, supabase, node:crypto) so it
// does not drag the server graph into the client bundle.
export function isInvitationValid(invitation: TenantInvitation): boolean {
  if (invitation.revokedAt) {
    return false;
  }
  return new Date(invitation.expiresAt).getTime() > Date.now();
}
