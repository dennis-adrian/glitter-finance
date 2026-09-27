import * as Sentry from "@sentry/nextjs";

/**
 * Where a client-side failure happened: the Sentry `component` tag and part of
 * the issue fingerprint.
 */
export type ClientFailureComponent =
  | "powersync_init"
  | "powersync_products_watch"
  | "powersync_inventory_watch"
  | "powersync_tenant_users_watch"
  | "powersync_sales_watch"
  | "powersync_sales_rebuild"
  | "powersync_draft_cart_hydrate"
  | "powersync_initial_movement_lookup"
  | "powersync_sync_failure_record";

const reportedFailures = new Set<string>();

// Error names and codes are identifiers ("TypeError", "SQLITE_BUSY",
// "23514"). Anything else, such as a message folded into the name, is
// dropped rather than sent.
const IDENTIFIER = /^[A-Za-z0-9_][\w.-]{0,63}$/;

function identifier(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" && IDENTIFIER.test(value) ? value : null;
}

/**
 * The only parts of a client failure that leave the device. Messages can
 * hold SQL, row values or tenant data, so they never do.
 */
export function clientFailureDetails(error: unknown): {
  name: string;
  code: string;
} {
  if (!error || typeof error !== "object") {
    return { name: "Error", code: "unknown" };
  }
  const candidate = error as { name?: unknown; code?: unknown };
  return {
    name: identifier(candidate.name) ?? "Error",
    code: identifier(candidate.code) ?? "unknown",
  };
}

export function resetReportedClientFailures() {
  reportedFailures.clear();
}

/**
 * Sends a client failure that the app only logged before (PowerSync start-up,
 * local watches, the draft cart) to Sentry. Each component, error name and
 * code is reported once per session: a watch that keeps failing would
 * otherwise send an event on every change. Returns whether it was sent.
 */
export function reportClientFailure(
  component: ClientFailureComponent,
  error: unknown
): boolean {
  const { name, code } = clientFailureDetails(error);
  const failureKey = `${component}:${name}:${code}`;
  if (reportedFailures.has(failureKey)) return false;
  reportedFailures.add(failureKey);

  Sentry.withScope((scope) => {
    scope.setLevel("error");
    scope.setTag("component", component);
    scope.setTag("error_name", name);
    scope.setTag("error_code", code);
    scope.setFingerprint(["client-failure", component, name, code]);
    const reportError = new Error(
      code === "unknown"
        ? `${component} failed`
        : `${component} failed (${code})`
    );
    reportError.name = name;
    Sentry.captureException(reportError);
  });

  return true;
}
