import assert from "node:assert/strict";
import test from "node:test";
import { assertServerEnv, REQUIRED_SERVER_ENV } from "@/lib/env";

const completeEnv = Object.fromEntries(
  REQUIRED_SERVER_ENV.map((name) => [name, `value-of-${name}`])
);

test("accepts an environment with every required server variable", () => {
  assert.doesNotThrow(() => assertServerEnv(completeEnv));
});

test("names every missing or blank required server variable at once", () => {
  assert.throws(
    () =>
      assertServerEnv({
        ...completeEnv,
        SUPABASE_SECRET_KEY: undefined,
        INVITATION_SECRET_KEY: "  ",
      }),
    {
      message:
        "Missing required environment variables: SUPABASE_SECRET_KEY, INVITATION_SECRET_KEY",
    }
  );
});
