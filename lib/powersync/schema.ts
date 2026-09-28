// PowerSync schema derived from the Drizzle SQLite tables in
// lib/db/client-schema.ts. PowerSyncProvider opens the per-device local
// SQLite database with it. Local queries are raw SQL; their row types come
// from the same tables (LocalRow in lib/db/client-schema.ts).

import { DrizzleAppSchema } from "@powersync/drizzle-driver";
import { clientSchema } from "@/lib/db/client-schema";

export const AppSchema = new DrizzleAppSchema(clientSchema);
