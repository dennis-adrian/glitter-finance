import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ACTIVE_TENANT_CLAIM =
  "tenant_id = auth.parameters() -> 'app_metadata' ->> 'tenant_id'";
const MEMBERSHIP =
  "tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.user_id())";

const rules = readFileSync("powersync/sync-rules.yaml", "utf8");

function streamQueries() {
  // Each query is a YAML list item; its continuation lines are folded.
  return rules
    .split(/\n\s*- (?=SELECT )/)
    .slice(1)
    .map((item) =>
      item
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    );
}

test("every synced table is scoped to the active tenant and a membership", () => {
  const queries = streamQueries();

  assert.equal(queries.length, rules.match(/SELECT \* FROM/g)?.length);
  for (const query of queries) {
    assert.ok(query.includes(ACTIVE_TENANT_CLAIM), query);
    // The claim alone would keep syncing a tenant the user was removed from.
    assert.ok(query.includes(`AND ${MEMBERSHIP}`), query);
  }
});
