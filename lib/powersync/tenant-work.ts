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

  resumeAfterFailedTeardown() {
    if (!this.abortController.signal.aborted) {
      return false;
    }

    this.abortController = new AbortController();
    return true;
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

/**
 * The app's tenant work: the controller, which cancels writes in flight, and
 * a generation. Effects that read or subscribe to one tenant's data depend
 * on the generation and check it before applying a result, so a teardown or
 * a newly ready identity makes them drop what they were doing and start
 * over. See useTenantWork (lib/powersync/use-tenant-work.ts).
 */
export type TenantWork = {
  /** Starts a write; see TenantWorkController.begin. */
  begin: TenantWorkController["begin"];
  /** Cancels every write in flight and moves to a new generation. */
  cancel: () => void;
  /** After a teardown that left the local data intact. */
  resumeAfterFailedTeardown: () => void;
  /**
   * Once the provider has this identity's local store ready. Moves to a new
   * generation only when the identity changed.
   */
  resumeForReadyIdentity: (identity: LocalDataIdentity) => void;
  /**
   * Captures the current generation. The returned check is false once the
   * generation moved on.
   */
  captureGeneration: () => () => boolean;
};

export function createTenantWork(
  identity: LocalDataIdentity,
  onGenerationChange: (generation: number) => void
): TenantWork {
  const controller = new TenantWorkController(identity);
  let generation = 0;

  function nextGeneration() {
    generation += 1;
    onGenerationChange(generation);
  }

  return {
    begin: () => controller.begin(),
    cancel: () => {
      controller.cancel();
      nextGeneration();
    },
    resumeAfterFailedTeardown: () => {
      controller.resumeAfterFailedTeardown();
      nextGeneration();
    },
    resumeForReadyIdentity: (nextIdentity) => {
      if (controller.resumeForReadyIdentity(nextIdentity)) {
        nextGeneration();
      }
    },
    captureGeneration: () => {
      const captured = generation;
      return () => generation === captured;
    },
  };
}
