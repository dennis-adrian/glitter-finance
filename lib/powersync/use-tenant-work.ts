"use client";

import { useState } from "react";
import type { LocalDataIdentity } from "@/lib/powersync/local-data-teardown";
import { createTenantWork, type TenantWork } from "@/lib/powersync/tenant-work";

/**
 * The tenant work (see createTenantWork) of a component that stays mounted
 * across identities: its current generation, for effect dependencies, and
 * its controls, which keep their identity across renders. It starts with
 * `identity` and follows resumeForReadyIdentity afterwards.
 */
export function useTenantWork(
  identity: LocalDataIdentity
): [generation: number, work: TenantWork] {
  const [generation, setGeneration] = useState(0);
  const [work] = useState(() => createTenantWork(identity, setGeneration));
  return [generation, work];
}
