// PowerSync schema derived from the Drizzle SQLite tables in
// lib/db/client-schema.ts. The PowerSync client (lands in PR 2) uses this to
// create the per-device local SQLite database; @powersync/drizzle-driver uses
// the same definitions to type client-side queries.

import { DrizzleAppSchema } from "@powersync/drizzle-driver";
import { clientSchema } from "@/lib/db/client-schema";

export const AppSchema = new DrizzleAppSchema(clientSchema);

export type Database = (typeof AppSchema)["types"];
