// Side-effecting import: loads env files before any module that reads
// process.env at import time (e.g. @/lib/db). ESM evaluates imports in order,
// so importing this first guarantees the env is populated. Variables already
// present in process.env (e.g. passed inline on the command line for a prod
// run) take precedence — dotenv does not override existing values.
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });
