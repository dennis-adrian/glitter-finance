// No `import "server-only"` here: the pnpm db:* scripts import this module
// under plain tsx, where that marker throws. postgres' Node-only
// dependencies already keep it out of client bundles.
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
// The pool is small on purpose: each serverless instance gets its own, and
// the transaction pooler multiplexes them onto the database. Seven covers the
// reads '/' starts at once (loadTenantData in app/page.tsx): categories,
// members, products, the sales history transaction, opening stock, recent
// movements and the invitation. Without prepared statements postgres.js cannot
// pipeline a query that has parameters, so each of them holds a connection of
// its own and a smaller pool makes the rest wait. Idle connections close after
// 20 s instead of being held for the instance's lifetime.
// The global cache avoids opening new clients on every Next.js dev hot reload.
export const client =
  globalForDb.glitterPostgres ??
  postgres(connectionString, {
    prepare: false,
    max: 7,
    idle_timeout: 20,
    connect_timeout: 10,
  });

export const db = globalForDb.glitterDb ?? drizzle(client, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.glitterPostgres = client;
  globalForDb.glitterDb = db;
}
