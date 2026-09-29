// What PowerSync reports when the connector (lib/powersync/connector.ts)
// refuses a session whose `app_metadata.tenant_id` claim is not the tenant
// this device's local data belongs to. Kept apart from the connector so the
// sync status can recognize the errors without loading it.

import { ACTIVE_TENANT_CHANGED_MESSAGE } from "@/lib/auth/tenant-context";

/**
 * The session's tenant claim is not the local data's tenant, and no refresh
 * has shown yet that the account's active tenant is another one: the refresh
 * failed or was not due. PowerSync retries with backoff, and it fixes itself
 * when the refreshed claim catches up (right after a switch or a join).
 */
export class TenantClaimMismatchError extends Error {
  constructor(
    message = "La sesión todavía no corresponde al puesto de este dispositivo. Si no se corrige sola, recarga la app."
  ) {
    super(message);
    this.name = "TenantClaimMismatchError";
  }
}

const ACTIVE_TENANT_CHANGED_ERROR_NAME = "ActiveTenantChangedError";

/**
 * A refreshed session claims another tenant: the account's active tenant
 * changed on another device. Retrying cannot fix it while this page runs,
 * since the local data belongs to the tenant the page was rendered with, so
 * the device shows it and asks for a reload, which moves the device to the
 * active tenant after uploading its pending work.
 */
export class ActiveTenantChangedError extends TenantClaimMismatchError {
  constructor() {
    super(ACTIVE_TENANT_CHANGED_MESSAGE);
    this.name = ACTIVE_TENANT_CHANGED_ERROR_NAME;
  }
}

/**
 * By name: PowerSync's shared sync worker passes the error on as a plain
 * object with the name and message only.
 */
export function isActiveTenantChangedError(
  error: { name?: unknown } | null | undefined
): boolean {
  return error?.name === ACTIVE_TENANT_CHANGED_ERROR_NAME;
}
