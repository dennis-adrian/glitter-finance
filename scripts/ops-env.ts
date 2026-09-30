// Which project the ops scripts (pnpm db:seed:qa, pnpm db:invite:tenant-user)
// write to. They write to Supabase Auth through NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SECRET_KEY, and to Postgres through DATABASE_URL, so all three must
// name the same project. A mix, such as a staging URL on the command line and
// the local DATABASE_URL from .env.local, would change auth users in one
// project and then fail, or write tenant rows, in the other.
//
// No side effects here: scripts/load-env.ts applies loadOpsEnv on import, and
// the scripts call confirmOpsTarget before their first write.
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parse } from "dotenv";

export const TARGET_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
] as const;

export const CONFIRM_FLAG = "--yes";

type Env = Record<string, string | undefined>;

export type EnvSource = { name: string; values: Env };

const isSet = (value: string | undefined) => Boolean(value?.trim());

/**
 * The environment a script runs with. Variables come from the first source
 * that sets them, as with dotenv. The three target variables are the
 * exception: all of them come from the first source that sets any of them,
 * so a partial override on the command line fails instead of being completed
 * from an env file that may name another project.
 */
export function resolveOpsEnv(sources: EnvSource[]): {
  env: Record<string, string>;
  targetSource: string;
} {
  const targetSource = sources.find((source) =>
    TARGET_ENV.some((name) => isSet(source.values[name]))
  );
  if (!targetSource) {
    throw new Error(
      `Missing ${TARGET_ENV.join(", ")}. Pass them on the command line, or ` +
        "set them in .env.local."
    );
  }
  const missing = TARGET_ENV.filter(
    (name) => !isSet(targetSource.values[name])
  );
  if (missing.length > 0) {
    const given = TARGET_ENV.filter((name) => !missing.includes(name));
    throw new Error(
      `${given.join(" and ")} ${given.length === 1 ? "comes" : "come"} from ` +
        `${targetSource.name}, but ${missing.join(" and ")} ` +
        `${missing.length === 1 ? "does" : "do"} not. Set all of ` +
        `${TARGET_ENV.join(", ")} in one place, so the script cannot mix ` +
        "two projects."
    );
  }

  const env: Record<string, string> = {};
  for (const name of TARGET_ENV) {
    env[name] = targetSource.values[name]!.trim();
  }
  for (const source of sources) {
    for (const [name, value] of Object.entries(source.values)) {
      if (value !== undefined && !(name in env)) {
        env[name] = value;
      }
    }
  }
  return { env, targetSource: targetSource.name };
}

/** Fills process.env for an ops script; returns where the target came from. */
export function loadOpsEnv(files = [".env.local", ".env"]): string {
  const sources: EnvSource[] = [
    { name: "the command line", values: { ...process.env } },
    ...files
      .filter((file) => existsSync(file))
      .map((file) => ({ name: file, values: parse(readFileSync(file)) })),
  ];
  const { env, targetSource } = resolveOpsEnv(sources);
  Object.assign(process.env, env);
  return targetSource;
}

export type OpsTarget = {
  supabaseUrl: string;
  supabaseProject: string | null;
  database: string;
  databaseProject: string | null;
  supabaseLocal: boolean;
  databaseLocal: boolean;
};

function isLocalHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1"
  );
}

function parseUrl(value: string, name: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL.`);
  }
}

export function describeOpsTarget(env: Env): OpsTarget {
  const supabase = parseUrl(
    env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    "NEXT_PUBLIC_SUPABASE_URL"
  );
  const database = parseUrl(env.DATABASE_URL ?? "", "DATABASE_URL");
  const user = decodeURIComponent(database.username);

  // <ref>.supabase.co for the API; db.<ref>.supabase.co for a direct
  // connection, or <role>.<ref> as the user on the shared pooler.
  const supabaseProject =
    supabase.hostname.match(/^([a-z0-9]+)\.supabase\.(?:co|in)$/)?.[1] ?? null;
  const databaseProject =
    database.hostname.match(/^db\.([a-z0-9]+)\.supabase\.(?:co|in)$/)?.[1] ??
    (/\.pooler\.supabase\.com$/.test(database.hostname)
      ? (user.match(/^[^.]+\.([a-z0-9]+)$/)?.[1] ?? null)
      : null);

  return {
    supabaseUrl: supabase.origin,
    supabaseProject,
    database:
      `${user ? `${user}@` : ""}${database.host}${database.pathname}`.replace(
        /\/$/,
        ""
      ),
    databaseProject,
    supabaseLocal: isLocalHost(supabase.hostname),
    databaseLocal: isLocalHost(database.hostname),
  };
}

/** Why the target cannot be one project, or null when it can. */
export function opsTargetMismatch(target: OpsTarget): string | null {
  if (target.supabaseLocal !== target.databaseLocal) {
    return target.supabaseLocal
      ? "NEXT_PUBLIC_SUPABASE_URL is the local stack but DATABASE_URL is not."
      : "DATABASE_URL is the local stack but NEXT_PUBLIC_SUPABASE_URL is not.";
  }
  if (
    target.supabaseProject &&
    target.databaseProject &&
    target.supabaseProject !== target.databaseProject
  ) {
    return (
      `NEXT_PUBLIC_SUPABASE_URL is project ${target.supabaseProject} but ` +
      `DATABASE_URL is project ${target.databaseProject}.`
    );
  }
  return null;
}

export function formatOpsTarget(target: OpsTarget, source: string): string {
  const project = (ref: string | null, local: boolean) =>
    local ? " (local stack)" : ref ? ` (project ${ref})` : "";
  return [
    `Target (from ${source}):`,
    `  Supabase: ${target.supabaseUrl}${project(target.supabaseProject, target.supabaseLocal)}`,
    `  Database: ${target.database}${project(target.databaseProject, target.databaseLocal)}`,
  ].join("\n");
}

export type ConfirmIo = {
  argv: string[];
  interactive: boolean;
  log: (message: string) => void;
  ask: (question: string) => Promise<string>;
};

async function askOnTerminal(question: string) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

function terminalIo(): ConfirmIo {
  return {
    argv: process.argv,
    interactive: Boolean(process.stdin.isTTY),
    log: (message) => console.log(message),
    ask: askOnTerminal,
  };
}

/**
 * Prints the target and refuses one that mixes projects. The local stack
 * needs no confirmation; any other project needs --yes, or "yes" typed at
 * the prompt.
 */
export async function confirmOpsTarget(
  action: string,
  source: string,
  env: Env = process.env,
  io: ConfirmIo = terminalIo()
): Promise<void> {
  const target = describeOpsTarget(env);
  io.log(formatOpsTarget(target, source));

  const mismatch = opsTargetMismatch(target);
  if (mismatch) {
    throw new Error(`${mismatch} Point all three variables at one project.`);
  }
  if (target.supabaseLocal) {
    return;
  }
  if (!target.supabaseProject || !target.databaseProject) {
    io.log("  Could not check that both name the same project.");
  }
  if (io.argv.includes(CONFIRM_FLAG)) {
    return;
  }
  if (!io.interactive) {
    throw new Error(
      `Refusing to ${action} on a hosted project without confirmation. ` +
        `Check the target above and re-run with ${CONFIRM_FLAG}.`
    );
  }
  const answer = await io.ask(`Type "yes" to ${action} on this project: `);
  if (answer.trim().toLowerCase() !== "yes") {
    throw new Error("Cancelled.");
  }
}
