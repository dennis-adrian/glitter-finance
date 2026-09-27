// Input checks shared by the screens, the PowerSync local writers and the
// server actions. They throw UserFacingError with a Spanish message, which a
// screen shows as is and a server action returns (lib/action-result.ts).

import { UserFacingError } from "@/lib/action-result";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longest discount reason, refund reason or stock note. */
export const MAX_NOTE_LENGTH = 200;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** The id in the lowercase form Postgres returns, or `message` as an error. */
export function requireUuid(value: unknown, message: string): string {
  if (!isUuid(value)) {
    throw new UserFacingError(message);
  }
  return value.toLowerCase();
}

/** Length in characters, the way Postgres' char_length counts them. */
export function characterCount(value: string) {
  return Array.from(value).length;
}

/**
 * An optional free-text note, trimmed, with blank as null. `label` names the
 * field in the error, e.g. "El motivo".
 */
export function normalizeNote(value: unknown, label: string): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new UserFacingError(`${label} no es válido.`);
  }
  const note = value.trim();
  if (characterCount(note) > MAX_NOTE_LENGTH) {
    throw new UserFacingError(
      `${label} no puede superar ${MAX_NOTE_LENGTH} caracteres.`
    );
  }
  return note || null;
}
