/**
 * Returns the Postgres SQLSTATE for a failed query. Drizzle wraps driver
 * errors in DrizzleQueryError, so the code lives on `cause` rather than on
 * the thrown error itself.
 */
export function postgresErrorCode(error: unknown): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      typeof current.code === "string"
    ) {
      return current.code;
    }
    current =
      typeof current === "object" && "cause" in current ? current.cause : null;
  }

  return null;
}
