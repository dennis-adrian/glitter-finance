import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { getDatabaseUrl } from "@/lib/env";

const connectionString = getDatabaseUrl();

const globalForDb = globalThis as unknown as {
  glitterPostgres?: ReturnType<typeof postgres>;
  glitterDb?: PostgresJsDatabase<typeof schema>;
};

// Supabase's pooler does not support prepared statements in transaction mode.
// The global cache avoids opening new clients on every Next.js dev hot reload.
export const client =
  globalForDb.glitterPostgres ??
  postgres(connectionString, {
    prepare: false,
  });

export const db = globalForDb.glitterDb ?? drizzle(client, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.glitterPostgres = client;
  globalForDb.glitterDb = db;
}
