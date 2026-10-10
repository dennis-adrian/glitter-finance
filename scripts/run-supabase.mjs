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

/** Every value given as `--flag value` or `--flag=value`. */
function flagValues(args, flag) {
  return args.flatMap((arg, index) => {
    if (arg === flag) {
      return [args[index + 1] ?? ""];
    }
    return arg.startsWith(`${flag}=`) ? [arg.slice(flag.length + 1)] : [];
  });
}

// The values the CLI takes for a bool flag, in `--flag=<value>` and, when the
// next argument is one of them, `--flag <value>`.
const TRUE_VALUES = ["true", "yes", "on", "1", "y"];
const FALSE_VALUES = ["false", "no", "off", "0", "n"];

/**
 * How each mention of the bool flag `--name` reads: true, false, or null when
 * CLI versions disagree. `--name false` is false to the current CLI but a bare
 * flag plus a stray argument to older ones, and a value outside the lists
 * above is an error to one and may be true to another.
 */
function boolFlagReadings(args, name) {
  const read = (value) =>
    TRUE_VALUES.includes(value)
      ? true
      : FALSE_VALUES.includes(value)
        ? false
        : null;
  return args.flatMap((arg, index) => {
    if (arg === `--${name}`) {
      return [FALSE_VALUES.includes(args[index + 1]) ? null : true];
    }
    if (arg.startsWith(`--${name}=`)) {
      return [read(arg.slice(name.length + 3))];
    }
    if (arg === `--no-${name}`) {
      return [false];
    }
    if (arg.startsWith(`--no-${name}=`)) {
      const value = read(arg.slice(name.length + 6));
      return [value === null ? null : !value];
    }
    return [];
  });
}

/** Whether every reading of the bool flag `--name` sets it. */
function surelySet(args, name) {
  const readings = boolFlagReadings(args, name);
  return readings.length > 0 && readings.every((value) => value === true);
}

/** Whether any reading of the bool flag `--name` may set it. */
function maybeSet(args, name) {
  return boolFlagReadings(args, name).some((value) => value !== false);
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
// other commands target the local stack by default. The CLI picks the linked
// project whenever `--linked` is written, whatever its value (`--linked=false`
// and `--no-linked` included), so any mention of it counts.
function targetsHostedProject(args, defaultHosted) {
  if (boolFlagReadings(args, "linked").length > 0) {
    return true;
  }
  const dbUrls = flagValues(args, "--db-url");
  if (dbUrls.length > 0) {
    return !dbUrls.every(isLocalDbUrl);
  }
  return defaultHosted && !surelySet(args, "local");
}

/**
 * Why the command would seed a hosted project, or null. supabase/seed.sql
 * creates a demo account with a published password, and `seed buckets`
 * uploads the local seed images and bucket settings: both are for the local
 * stack only (README, "Hand-written SQL" and "PowerSync setup").
 */
function remoteSeedRefusal(args) {
  const [command, subcommand] = args;

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
    !surelySet(args, "no-seed") &&
    targetsHostedProject(args, false)
  ) {
    return "`supabase db reset` on a hosted project also runs supabase/seed.sql, which creates a demo account with a known password. Add --no-seed.";
  }
  if (
    command === "db" &&
    subcommand === "push" &&
    maybeSet(args, "include-seed") &&
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
