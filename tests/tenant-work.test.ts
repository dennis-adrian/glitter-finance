import assert from "node:assert/strict";
import test from "node:test";
import {
  createTenantWork,
  TenantWorkCancelledError,
} from "@/lib/powersync/tenant-work";

const identity = { userId: "user-1", tenantId: "tenant-a" };

function tenantWork() {
  const generations: number[] = [];
  const work = createTenantWork(identity, (generation) =>
    generations.push(generation)
  );
  return { work, generations };
}

test("cancelling stops writes in flight and moves to a new generation", () => {
  const { work, generations } = tenantWork();
  const write = work.begin();
  const isCurrentGeneration = work.captureGeneration();

  work.cancel();

  assert.equal(write.isCurrent(), false);
  assert.throws(() => write.assertCurrent(), TenantWorkCancelledError);
  assert.equal(isCurrentGeneration(), false);
  assert.equal(work.captureGeneration()(), true);
  assert.deepEqual(generations, [1]);
  // Until a teardown fails or a new identity is ready, new writes stay
  // cancelled.
  assert.equal(work.begin().isCurrent(), false);
});

test("a failed teardown resumes writes in a new generation", () => {
  const { work, generations } = tenantWork();
  work.cancel();
  const isCurrentGeneration = work.captureGeneration();

  work.resumeAfterFailedTeardown();

  assert.equal(work.begin().isCurrent(), true);
  assert.equal(isCurrentGeneration(), false);
  assert.deepEqual(generations, [1, 2]);
});

test("only a different ready identity starts a new generation", () => {
  const { work, generations } = tenantWork();
  const write = work.begin();

  work.resumeForReadyIdentity({ ...identity });
  assert.equal(write.isCurrent(), true);
  assert.deepEqual(generations, []);

  work.resumeForReadyIdentity({ ...identity, tenantId: "tenant-b" });
  assert.equal(write.isCurrent(), false);
  assert.equal(work.begin().isCurrent(), true);
  assert.deepEqual(generations, [1]);
});
