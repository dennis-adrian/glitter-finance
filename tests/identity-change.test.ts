import assert from "node:assert/strict";
import test from "node:test";
import { changeIdentityAfterLocalTeardown } from "@/lib/auth/identity-change";
import { LocalDataTeardownError } from "@/lib/powersync/local-data-teardown";

function recorder() {
  const events: string[] = [];
  return {
    events,
    input: {
      destination: "/",
      failureMessage: "No se pudo cambiar de puesto.",
      reportFailure: (message: string) => {
        events.push(`report:${message}`);
      },
      navigate: (destination: string) => {
        events.push(`navigate:${destination}`);
      },
    },
  };
}

test("a refused teardown never reaches the server step", async () => {
  const { events, input } = recorder();
  const refusal = new LocalDataTeardownError(
    "pending-uploads",
    "Hay 1 operación sin subir a la nube."
  );

  await assert.rejects(
    changeIdentityAfterLocalTeardown({
      ...input,
      teardown: async () => {
        events.push("teardown");
        throw refusal;
      },
      commit: async () => {
        events.push("commit");
      },
    }),
    (error) => error === refusal
  );

  assert.deepEqual(events, ["teardown"]);
});

test("a failed server step after teardown is reported, not thrown", async () => {
  const { events, input } = recorder();

  const navigating = await changeIdentityAfterLocalTeardown({
    ...input,
    teardown: async () => {
      events.push("teardown");
    },
    commit: async () => {
      events.push("commit");
      throw new Error("No pertenecés a este puesto.");
    },
  });

  assert.equal(navigating, false);
  assert.deepEqual(events, [
    "teardown",
    "commit",
    "report:No pertenecés a este puesto.",
  ]);
});

test("a server failure without a message uses the fallback", async () => {
  const { events, input } = recorder();

  await changeIdentityAfterLocalTeardown({
    ...input,
    teardown: async () => {},
    commit: async () => {
      throw "offline";
    },
  });

  assert.deepEqual(events, ["report:No se pudo cambiar de puesto."]);
});

test("a completed change loads the destination", async () => {
  const { events, input } = recorder();

  const navigating = await changeIdentityAfterLocalTeardown({
    ...input,
    destination: "/login",
    teardown: async () => {
      events.push("teardown");
    },
    commit: async () => {
      events.push("commit");
    },
  });

  assert.equal(navigating, true);
  assert.deepEqual(events, ["teardown", "commit", "navigate:/login"]);
});
