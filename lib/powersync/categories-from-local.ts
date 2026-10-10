// Maps the categories rows PowerSync replicates into the local SQLite store
// to the Category shape, like the server repository does for Postgres rows
// (lib/categories/repository.ts).

import type { categories, LocalRow } from "@/lib/db/client-schema";
import type { Category } from "@/lib/types";

export type LocalCategoryRow = LocalRow<typeof categories>;

export function mapLocalCategoryRow(row: LocalCategoryRow): Category {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
