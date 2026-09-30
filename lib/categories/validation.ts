// Category name checks shared by the category screens, the PowerSync local
// writers and the server actions. They throw UserFacingError with a Spanish
// message (lib/action-result.ts).

import { UserFacingError } from "@/lib/action-result";
import { ALL_CATEGORIES } from "@/lib/categories";
import { characterCount } from "@/lib/validation";

// Postgres enforces the same length (categories_name_valid_check in
// lib/db/schema.ts).
export const categoryNameMaxLength = 40;

export function normalizeCategoryName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/** The name as it is stored: trimmed, single-spaced, within the length. */
export function validateCategoryName(value: unknown) {
  if (typeof value !== "string") {
    throw new UserFacingError("El nombre de la categoría no es válido.");
  }
  const name = normalizeCategoryName(value);

  if (!name) {
    throw new UserFacingError("Escribí un nombre para la categoría.");
  }
  if (characterCount(name) > categoryNameMaxLength) {
    throw new UserFacingError(
      `El nombre de la categoría no puede superar ${categoryNameMaxLength} caracteres.`
    );
  }
  // The rails' show-everything filter; a category by that name could never
  // be filtered on its own.
  if (categoryNamesMatch(name, ALL_CATEGORIES)) {
    throw new UserFacingError(
      `"${ALL_CATEGORIES}" es el filtro que muestra todos los productos. Elegí otro nombre.`
    );
  }

  return name;
}

export function categoryNamesMatch(first: string, second: string) {
  return (
    normalizeCategoryName(first).localeCompare(
      normalizeCategoryName(second),
      undefined,
      { sensitivity: "accent" }
    ) === 0
  );
}
