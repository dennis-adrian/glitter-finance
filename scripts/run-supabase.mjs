import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

// Next.js loads .env.local automatically; the Supabase CLI does not. Load the
// same local file before config.toml resolves env(...) provider credentials.
if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/run-supabase.mjs <command> [...args]");
  process.exit(1);
}

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
