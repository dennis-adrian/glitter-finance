import type { TenantInvitation } from "@/lib/types";

export const INVITE_ORIGIN_UNAVAILABLE_MESSAGE =
  "No se pudo determinar la URL pública de la app. Configura NEXT_PUBLIC_APP_URL o APP_URL en el servidor para compartir invitaciones.";

// Pure invitation helpers safe to import from client components. Keep this
// module free of server-only dependencies (db, supabase, node:crypto) so it
// does not drag the server graph into the client bundle.
export function isAbsoluteHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function buildInviteLink(origin: string, token: string): string {
  const trimmedOrigin = origin.trim().replace(/\/+$/, "");
  if (!trimmedOrigin || !token) {
    return "";
  }
  const link = `${trimmedOrigin}/join/${token}`;
  return isAbsoluteHttpUrl(link) ? link : "";
}

export function isInvitationValid(invitation: TenantInvitation): boolean {
  if (invitation.revokedAt) {
    return false;
  }
  return new Date(invitation.expiresAt).getTime() > Date.now();
}
