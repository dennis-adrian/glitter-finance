import assert from "node:assert/strict";
import test from "node:test";
import { resolveSentryTarget } from "@/lib/observability/sentry-options";

test("Vercel production and preview report under their own environment", () => {
  for (const vercelEnv of ["production", "preview"]) {
    const target = resolveSentryTarget({ vercelEnv, configuredDsn: undefined });
    assert.equal(target.enabled, true);
    assert.equal(target.environment, vercelEnv);
    assert.match(String(target.dsn), /^https:\/\/.+\.ingest\..+sentry\.io\//);
  }
});

test("local builds stay silent without an explicit DSN", () => {
  for (const vercelEnv of [undefined, "", "development"]) {
    const target = resolveSentryTarget({ vercelEnv, configuredDsn: "  " });
    assert.equal(target.enabled, false);
  }
  assert.equal(
    resolveSentryTarget({ vercelEnv: undefined, configuredDsn: undefined })
      .environment,
    "local"
  );
});

test("an explicit DSN enables reporting, tagged local off Vercel", () => {
  const dsn = "https://key@example.ingest.sentry.io/1";
  assert.deepEqual(
    resolveSentryTarget({ vercelEnv: undefined, configuredDsn: ` ${dsn} ` }),
    { dsn, enabled: true, environment: "local" }
  );
  assert.deepEqual(
    resolveSentryTarget({ vercelEnv: "development", configuredDsn: dsn }),
    { dsn, enabled: true, environment: "development" }
  );
});
