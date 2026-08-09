"use client";

/** Never invoke the server sign-out until local user-data teardown succeeds. */
export async function signOutAfterLocalTeardown(
  teardown: () => Promise<void>,
  serverSignOut: () => Promise<void>
) {
  await teardown();
  await serverSignOut();
}
