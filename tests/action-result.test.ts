import assert from "node:assert/strict";
import test from "node:test";
import {
  toActionResult,
  unwrapActionResult,
  UserFacingError,
} from "@/lib/action-result";

test("an action returns its data, or its expected failure's message", async () => {
  assert.deepEqual(await toActionResult(async () => ({ id: "sale-1" })), {
    ok: true,
    data: { id: "sale-1" },
  });
  assert.deepEqual(
    await toActionResult(async () => {
      throw new UserFacingError("Esta venta ya fue anulada.");
    }),
    { ok: false, error: "Esta venta ya fue anulada." }
  );
});

test("an action still throws bugs and outages", async () => {
  const outage = new Error("Failed query: select 1\nparams: ");
  await assert.rejects(
    toActionResult(async () => {
      throw outage;
    }),
    (error) => error === outage
  );
});

test("the client gets the data or a message it can show", async (t) => {
  const consoleError = t.mock.method(console, "error", () => {});

  assert.equal(
    await unwrapActionResult(
      async () => ({ ok: true, data: 42 }),
      "No se pudo."
    ),
    42
  );
  await assert.rejects(
    unwrapActionResult(
      async () => ({ ok: false, error: "No pertenecés a esta cuenta." }),
      "No se pudo."
    ),
    { name: "UserFacingError", message: "No pertenecés a esta cuenta." }
  );
  assert.equal(consoleError.mock.callCount(), 0);

  // What a thrown action looks like in production: Next.js' generic text.
  const masked = new Error(
    "An error occurred in the Server Components render."
  );
  await assert.rejects(
    unwrapActionResult(async () => {
      throw masked;
    }, "No se pudo registrar la venta"),
    (error) =>
      error instanceof UserFacingError &&
      error.message === "No se pudo registrar la venta" &&
      error.cause === masked
  );
  assert.equal(consoleError.mock.callCount(), 1);
});
