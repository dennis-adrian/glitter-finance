export const categoryNameMaxLength = 40;

export function normalizeCategoryName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function validateCategoryName(value: string) {
  const name = normalizeCategoryName(value);

  if (!name) {
    throw new Error("Escribí un nombre para la categoría.");
  }
  if (name.length > categoryNameMaxLength) {
    throw new Error(
      `El nombre de la categoría no puede superar ${categoryNameMaxLength} caracteres.`
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
