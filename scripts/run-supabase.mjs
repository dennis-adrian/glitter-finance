import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

// The oldest Supabase CLI that supabase/config.toml is tested with. Raise it
// together with the version in README "Run locally" when config.toml starts
// using a newer CLI's settings.
const MIN_CLI_VERSION = "2.115.0";

// Lets a seed run against a hosted project anyway; never passed to the CLI.
const ALLOW_REMOTE_SEED = "--allow-remote-seed";

// Next.js loads .env.local automatically; the Supabase CLI does not. Load the
// same local file before config.toml resolves env(...) provider credentials.
if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
}

const cliArgs = process.argv.slice(2);
if (cliArgs.length === 0) {
  console.error("Usage: node scripts/run-supabase.mjs <command> [...args]");
  process.exit(1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseVersion(text) {
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function isOlder(version, minimum) {
  for (let i = 0; i < 3; i += 1) {
    if (version[i] !== minimum[i]) {
      return version[i] < minimum[i];
    }
  }
  return false;
}

function checkCliVersion() {
  const result = spawnSync("supabase", ["--version"], {
    encoding: "utf8",
    env: process.env,
  });
  const install = `Install Supabase CLI ${MIN_CLI_VERSION} or later (README, "Run locally").`;
  if (result.error) {
    fail(`Could not run the Supabase CLI: ${result.error.message}. ${install}`);
  }
  const version = parseVersion(result.stdout ?? "");
  if (!version) {
    console.warn(
      `Could not read the Supabase CLI version; this repo expects ${MIN_CLI_VERSION} or later.`
    );
    return;
  }
  if (isOlder(version, parseVersion(MIN_CLI_VERSION))) {
    fail(`Supabase CLI ${version.join(".")} is too old. ${install}`);
  }
}

/** The value of `--flag value` or `--flag=value`, if present. */
function flagValue(args, flag) {
  const index = args.findIndex(
    (arg) => arg === flag || arg.startsWith(`${flag}=`)
  );
  if (index === -1) {
    return null;
  }
  const arg = args[index];
  return arg === flag ? (args[index + 1] ?? "") : arg.slice(flag.length + 1);
}

function isLocalDbUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return ["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    return false;
  }
}

// Whether the command writes to a hosted database rather than the local
// stack. `db push` targets the linked project unless told otherwise; the
// other commands target the local stack by default.
function targetsHostedProject(args, defaultHosted) {
  if (args.includes("--linked")) {
    return true;
  }
  const dbUrl = flagValue(args, "--db-url");
  if (dbUrl !== null) {
    return !isLocalDbUrl(dbUrl);
  }
  return defaultHosted && !args.includes("--local");
}

/**
 * Why the command would seed a hosted project, or null. supabase/seed.sql
 * creates a demo account with a published password, and `seed buckets`
 * uploads the local seed images and bucket settings: both are for the local
 * stack only (README, "Hand-written SQL" and "PowerSync setup").
 */
function remoteSeedRefusal(args) {
  const [command, subcommand] = args;
  const has = (flag) => args.includes(flag);

  if (
    command === "seed" &&
    subcommand === "buckets" &&
    targetsHostedProject(args, false)
  ) {
    return "`supabase seed buckets` on a hosted project uploads the local seed images and bucket settings. Hosted buckets get their settings from supabase/manual/.";
  }
  if (
    command === "db" &&
    subcommand === "reset" &&
    !has("--no-seed") &&
    targetsHostedProject(args, false)
  ) {
    return "`supabase db reset` on a hosted project also runs supabase/seed.sql, which creates a demo account with a known password. Add --no-seed.";
  }
  if (
    command === "db" &&
    subcommand === "push" &&
    has("--include-seed") &&
    targetsHostedProject(args, true)
  ) {
    return "`supabase db push --include-seed` would run supabase/seed.sql, which creates a demo account with a known password, on a hosted project. Drop --include-seed.";
  }
  return null;
}

const allowRemoteSeed = cliArgs.includes(ALLOW_REMOTE_SEED);
const args = cliArgs.filter((arg) => arg !== ALLOW_REMOTE_SEED);
const refusal = remoteSeedRefusal(args);
if (refusal && !allowRemoteSeed) {
  fail(
    `Refusing to run: ${refusal}\nIf you really mean it, add ${ALLOW_REMOTE_SEED}.`
  );
}

checkCliVersion();

const result = spawnSync("supabase", args, {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Could not run Supabase CLI: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
