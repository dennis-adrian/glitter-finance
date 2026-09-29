/**
 * The product editor's sessions: each opening of the editor starts one, and
 * leaving it ends it. A save runs on after the editor that started it
 * closes (Volver stays enabled while it waits on the network), so what it
 * does once it finishes depends on whether its session is still the open
 * one: only then does it return to the catalog, and only then may a retry in
 * that same session update the product it created instead of adding
 * another.
 */
export type ProductEditorSessions<T> = {
  /** The open session's number (or the gap after the last one closed). */
  current: () => number;
  /**
   * Ends the current session, when the editor opens or closes. Returns the
   * number of the one that follows.
   */
  next: () => number;
  /** The product a save in `session` created, kept while that is open. */
  rememberCreated: (session: number, product: T) => void;
  /** The product a save in `session` created, if it is still open. */
  createdIn: (session: number) => T | null;
};

export function createProductEditorSessions<T>(): ProductEditorSessions<T> {
  let current = 0;
  let created: { session: number; product: T } | null = null;
  return {
    current: () => current,
    next() {
      current += 1;
      created = null;
      return current;
    },
    rememberCreated(session, product) {
      if (session === current) {
        created = { session, product };
      }
    },
    createdIn(session) {
      return created && created.session === session && session === current
        ? created.product
        : null;
    },
  };
}
