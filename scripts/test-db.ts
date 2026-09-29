// pnpm test:db: builds a throwaway Postgres cluster the way `pnpm db:reset`
// builds the local database (migrations, then every supabase/manual file,
// then supabase/seed.sql), and runs the SQL assertions in tests/db against
// it. They cover what the unit tests cannot: RLS between tenants, the
// financial RPCs and the triggers.
//
// Needs the PostgreSQL server binaries (initdb, pg_ctl, postgres and psql) on
// PATH, or their directory in PG_BIN; Homebrew's versioned formulas such as
// postgresql@17 put nothing on PATH. It does not use Docker, the Supabase
// stack or any DATABASE_URL: the cluster lives in a new private directory
// under /tmp, listens only on a Unix socket in that directory, and is
// deleted at the end.
//
// Usage:
//   pnpm test:db                 # every tests/db/*.test.sql
//   pnpm test:db -- rls          # only files whose name contains "rls"
//   pnpm test:db -- --keep       # leave the cluster running to explore it
//   PG_BIN="$(brew --prefix postgresql@17)/bin" pnpm test:db
//   PG_BIN=/usr/lib/postgresql/17/bin pnpm test:db
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TESTS_DIR = join(ROOT, "tests/db");

// Postgres refuses to start from a multithreaded process under some macOS
// locales, and initdb picks the collation from the environment.
const POSTGRES_ENV = { ...process.env, LANG: "C", LC_ALL: "C" };

function sqlFiles(dir: string, suffix = ".sql") {
  return readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .sort()
    .map((name) => join(dir, name));
}

function binDir(): string | null {
  if (process.env.PG_BIN) {
    return process.env.PG_BIN;
  }
  const result = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim()
    ? result.stdout.trim()
    : null;
}

const pgBin = binDir();
const bin = (name: string) => (pgBin ? join(pgBin, name) : name);

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = POSTGRES_ENV
): SpawnSyncReturns<string> {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", env });
  if (result.error) {
    throw new Error(
      `Could not run ${command}: ${result.error.message}. Install the ` +
        "PostgreSQL server binaries or set PG_BIN to their directory."
    );
  }
  return result;
}

// The port only names the socket file, which no other server shares.
const PORT = 5432;

type Cluster = { dir: string; dataDir: string };

function startCluster(): Cluster {
  // The superuser needs no password, so the server takes connections only
  // through a Unix socket in this directory, which mkdtemp makes private to
  // the current user: no other user, and nothing on TCP, can reach it. /tmp
  // rather than the per-user temporary directory keeps the socket's path
  // under macOS's 103-byte limit.
  const dir = mkdtempSync("/tmp/glitter-test-db-");
  const dataDir = join(dir, "data");

  const init = run(bin("initdb"), [
    "-D",
    dataDir,
    "-U",
    "postgres",
    "--auth=trust",
    "--no-locale",
    "--encoding=UTF8",
  ]);
  if (init.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`initdb failed:\n${init.stderr || init.stdout}`);
  }

  const start = run(bin("pg_ctl"), [
    "-D",
    dataDir,
    "-l",
    join(dir, "postgres.log"),
    "-o",
    `-p ${PORT} -c listen_addresses='' -c unix_socket_directories='${dir}' -c fsync=off`,
    "-w",
    "start",
  ]);
  if (start.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`pg_ctl start failed:\n${start.stderr || start.stdout}`);
  }

  return { dir, dataDir };
}

function stopCluster(cluster: Cluster) {
  run(bin("pg_ctl"), ["-D", cluster.dataDir, "-m", "immediate", "-w", "stop"]);
  rmSync(cluster.dir, { recursive: true, force: true });
}

function psql(cluster: Cluster, file: string, showNotices = false) {
  return run(
    bin("psql"),
    [
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      cluster.dir,
      "-p",
      String(PORT),
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-f",
      relative(file),
    ],
    {
      ...POSTGRES_ENV,
      PGOPTIONS: `-c client_min_messages=${showNotices ? "notice" : "warning"}`,
    }
  );
}

function relative(file: string) {
  return file.startsWith(`${ROOT}/`) ? file.slice(ROOT.length + 1) : file;
}

function apply(cluster: Cluster, files: string[]) {
  for (const file of files) {
    const result = psql(cluster, file);
    if (result.status !== 0) {
      throw new Error(`${relative(file)} failed:\n${result.stderr}`);
    }
  }
}

/** Runs one test file; returns false when it failed. */
function runTestFile(cluster: Cluster, file: string): boolean {
  const result = psql(cluster, file, true);
  const lines = result.stderr.split("\n");
  const passed = lines.filter((line) => /NOTICE:\s+ok - /.test(line));
  for (const line of passed) {
    console.log(`  ${line.replace(/^.*NOTICE:\s+/, "")}`);
  }
  if (result.status === 0) {
    console.log(`✔ ${relative(file)} (${passed.length} assertions)`);
    return true;
  }
  // A failed assertion says everything in its message; any other error also
  // needs the context of the function that raised it.
  const failedAssertion = lines.some((line) => /ERROR:\s+not ok - /.test(line));
  const errors = lines.filter((line) =>
    failedAssertion
      ? /ERROR:/.test(line)
      : /ERROR:|DETAIL:|HINT:|CONTEXT:/.test(line)
  );
  console.log(`✖ ${relative(file)}`);
  for (const line of errors.length > 0 ? errors : lines) {
    console.log(`  ${line}`);
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const keep = args.includes("--keep");
  const filters = args.filter((arg) => !arg.startsWith("--"));

  const tests = sqlFiles(TESTS_DIR, ".test.sql").filter(
    (file) =>
      filters.length === 0 || filters.some((filter) => file.includes(filter))
  );
  if (tests.length === 0) {
    throw new Error(
      `No tests/db/*.test.sql file matches ${filters.join(", ")}`
    );
  }

  const version = run(bin("postgres"), ["--version"]).stdout.trim();
  const cluster = startCluster();
  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (keep) {
      console.log(
        `\nThe cluster is still running:\n` +
          `  psql -h ${cluster.dir} -p ${PORT} -U postgres postgres\n` +
          `Stop and delete it with:\n` +
          `  pg_ctl -D ${cluster.dataDir} stop && rm -rf ${cluster.dir}`
      );
    } else {
      stopCluster(cluster);
    }
  };
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    process.on(signal, () => {
      stop();
      process.exit(code);
    });
  }

  try {
    const migrations = sqlFiles(join(ROOT, "supabase/migrations"));
    const manual = sqlFiles(join(ROOT, "supabase/manual"));
    console.log(
      `${version}: applying ${migrations.length} migrations, ` +
        `${manual.length} manual SQL files (twice) and seed.sql`
    );
    apply(cluster, [join(TESTS_DIR, "supabase-stubs.sql"), ...migrations]);
    apply(cluster, manual);
    // Every manual file must be safe to re-run (README, "Hand-written SQL").
    apply(cluster, manual);
    apply(cluster, [
      join(ROOT, "supabase/seed.sql"),
      join(TESTS_DIR, "test-helpers.sql"),
    ]);

    let failed = 0;
    for (const file of tests) {
      if (!runTestFile(cluster, file)) {
        failed += 1;
      }
    }

    if (failed > 0) {
      throw new Error(`${failed} of ${tests.length} test files failed.`);
    }
  } finally {
    stop();
  }
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
