// The contract between server actions and the screens that call them.
//
// In production Next.js replaces the message of an error thrown by a server
// action with a generic English one, and onRequestError reports it to
// Sentry. So an expected failure (invalid input, a changed active tenant, a
// sale outside the void window) is thrown as a UserFacingError, and the
// action returns it as `{ ok: false, error }` with its Spanish message.
// Actions throw only for bugs and outages.

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** An expected failure whose message is written for the user, in Spanish. */
export class UserFacingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UserFacingError";
  }
}

/** Server: runs an action's body and returns its UserFacingErrors. */
export async function toActionResult<T>(
  run: () => Promise<T>
): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof UserFacingError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/**
 * Client: calls a server action and resolves to its data, or throws a
 * UserFacingError whose message the screen can show as is (in a toast, or
 * next to the form). An action that threw (a bug, an outage, no network)
 * carries no message worth showing, so it becomes `fallbackMessage`.
 */
export async function unwrapActionResult<T>(
  call: () => Promise<ActionResult<T>>,
  fallbackMessage: string
): Promise<T> {
  let result: ActionResult<T>;
  try {
    result = await call();
  } catch (error) {
    console.error("[server-action] failed", error);
    throw new UserFacingError(fallbackMessage, { cause: error });
  }
  if (!result.ok) {
    throw new UserFacingError(result.error);
  }
  return result.data;
}
