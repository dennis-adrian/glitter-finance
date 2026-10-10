import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The first two characters of a name or email, as avatars show them, or "?"
 * when there is none.
 */
export function initialsOf(identity: string | null | undefined) {
  const trimmed = identity?.trim();
  return trimmed ? trimmed.slice(0, 2).toUpperCase() : "?";
}
