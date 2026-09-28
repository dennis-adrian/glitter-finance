// scripts/run-supabase.mjs, run as `pnpm db:*` runs it, against a stand-in
// `supabase` executable that records its arguments instead of touching any
// database.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";

const SCRIPT = resolve("scripts/run-supabase.mjs");
const dir = mkdtempSync(join(tmpdir(), "run-supabase-test-"));
const argsFile = join(dir, "args.txt");

writeFileSync(
  join(dir, "supabase"),
  [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then echo "$FAKE_SUPABASE_VERSION"; exit 0; fi',
    'printf "%s\\n" "$@" > "$FAKE_SUPABASE_ARGS"',
    "exit 0",
    "",
  ].join("\n")
);
chmodSync(join(dir, "supabase"), 0o755);

after(() => rmSync(dir, { recursive: true, force: true }));

function runSupabase(args: string[], version = "9.9.9", path = dir) {
  rmSync(argsFile, { force: true });
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    // No .env.local here, so nothing from the developer's env is loaded.
    cwd: dir,
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: path,
      FAKE_SUPABASE_VERSION: version,
      FAKE_SUPABASE_ARGS: argsFile,
    },
  });
  return {
    status: result.status,
    stderr: result.stderr,
    cliArgs: existsSync(argsFile)
      ? readFileSync(argsFile, "utf8").trim().split("\n")
      : null,
  };
}

test("passes the command through to the Supabase CLI", () => {
  const run = runSupabase(["db", "push"]);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.cliArgs, ["db", "push"]);

  assert.deepEqual(runSupabase(["db", "reset"]).cliArgs, ["db", "reset"]);
  assert.deepEqual(runSupabase(["seed", "buckets"]).cliArgs, [
    "seed",
    "buckets",
  ]);
});

test("refuses to seed buckets of a hosted project", () => {
  const run = runSupabase(["seed", "buckets", "--linked"]);
  assert.equal(run.status, 1);
  assert.equal(run.cliArgs, null);
  assert.match(run.stderr, /seed images/);
  assert.match(run.stderr, /--allow-remote-seed/);
});

test("refuses a hosted reset that would run seed.sql", () => {
  for (const args of [
    ["db", "reset", "--linked"],
    [
      "db",
      "reset",
      "--db-url",
      "postgresql://postgres:x@db.abc.supabase.co/postgres",
    ],
    [
      "db",
      "reset",
      "--db-url=postgresql://postgres:x@db.abc.supabase.co/postgres",
    ],
  ]) {
    const run = runSupabase(args);
    assert.equal(run.status, 1, args.join(" "));
    assert.equal(run.cliArgs, null, args.join(" "));
    assert.match(run.stderr, /--no-seed/);
  }

  assert.deepEqual(
    runSupabase(["db", "reset", "--linked", "--no-seed"]).cliArgs,
    ["db", "reset", "--linked", "--no-seed"]
  );
  const localUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  assert.deepEqual(runSupabase(["db", "reset", "--db-url", localUrl]).cliArgs, [
    "db",
    "reset",
    "--db-url",
    localUrl,
  ]);
});

test("refuses to push seed.sql to the linked project", () => {
  const run = runSupabase(["db", "push", "--include-seed"]);
  assert.equal(run.status, 1);
  assert.equal(run.cliArgs, null);

  assert.deepEqual(
    runSupabase(["db", "push", "--local", "--include-seed"]).cliArgs,
    ["db", "push", "--local", "--include-seed"]
  );
});

test("an explicit flag lets a remote seed through, without the flag", () => {
  const run = runSupabase([
    "seed",
    "buckets",
    "--linked",
    "--allow-remote-seed",
  ]);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.cliArgs, ["seed", "buckets", "--linked"]);
});

test("requires the minimum Supabase CLI version", () => {
  const old = runSupabase(["db", "push"], "2.100.3");
  assert.equal(old.status, 1);
  assert.equal(old.cliArgs, null);
  assert.match(old.stderr, /2\.100\.3 is too old/);

  assert.equal(runSupabase(["db", "push"], "9.9.9").status, 0);
});

test("says how to install the CLI when it is missing", () => {
  const run = runSupabase(["db", "push"], "9.9.9", join(dir, "empty"));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Install Supabase CLI \d+\.\d+\.\d+ or later/);
});
