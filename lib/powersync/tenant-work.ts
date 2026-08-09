import type { LocalDataIdentity } from "@/lib/powersync/local-data-teardown";

export class TenantWorkCancelledError extends Error {
  constructor() {
    super("Tenant work was cancelled.");
    this.name = "TenantWorkCancelledError";
  }
}

function identitiesMatch(current: LocalDataIdentity, next: LocalDataIdentity) {
  return current.userId === next.userId && current.tenantId === next.tenantId;
}

export class TenantWorkController {
  private abortController = new AbortController();
  private generation = 0;
  private identity: LocalDataIdentity;

  constructor(identity: LocalDataIdentity) {
    this.identity = { ...identity };
  }

  begin() {
    const generation = this.generation;
    const signal = this.abortController.signal;
    const isCurrent = () => !signal.aborted && this.generation === generation;
    const assertCurrent = () => {
      if (!isCurrent()) {
        throw new TenantWorkCancelledError();
      }
    };

    return { isCurrent, assertCurrent };
  }

  cancel() {
    if (this.abortController.signal.aborted) {
      return;
    }
    this.abortController.abort();
    this.generation += 1;
  }

  resumeForReadyIdentity(identity: LocalDataIdentity) {
    if (identitiesMatch(this.identity, identity)) {
      return false;
    }

    this.cancel();
    this.identity = { ...identity };
    this.abortController = new AbortController();
    return true;
  }
}
