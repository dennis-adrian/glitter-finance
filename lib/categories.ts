// Product categories are the tenant's own records (the categories table):
// lib/categories/validation.ts checks their names, and
// lib/categories/repository.ts and lib/powersync/write-categories.ts write
// them. A product stores its category's name, as the tenant spelled it.

/**
 * The category rails' show-everything filter. Never a stored category: the
 * rails add it in front of the tenant's own.
 */
export const ALL_CATEGORIES = "Todos";

/**
 * Categories in the order the rails, the category screen and the editor's
 * select list them: by name, ignoring case and accents.
 */
export function sortCategories<T extends { name: string }>(
  items: readonly T[]
): T[] {
  return [...items].sort((first, second) =>
    first.name.localeCompare(second.name, "es", { sensitivity: "base" })
  );
}
