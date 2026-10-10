// Side-effecting import: loads env files before any module that reads
// process.env at import time (e.g. @/lib/db). ESM evaluates imports in order,
// so importing this first guarantees the env is populated. Variables passed
// inline on the command line take precedence over .env.local, which takes
// precedence over .env. The target (NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SECRET_KEY, DATABASE_URL) comes whole from one of them: see
// scripts/ops-env.ts.
import { loadOpsEnv } from "./ops-env";

function load(): string {
  try {
    return loadOpsEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/** Where the target variables came from, for confirmOpsTarget. */
export const opsEnvSource = load();
