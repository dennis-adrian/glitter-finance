-- Custom SQL migration: auth.users FKs, tenant_invitations RLS, and revoke-only
-- trigger. Drizzle cannot model auth.users references or RLS policies.
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_created_by_user_id_auth_users_id_fk'
  ) THEN
    ALTER TABLE "tenants"
      ADD CONSTRAINT "tenants_created_by_user_id_auth_users_id_fk"
      FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_invitations_created_by_user_id_auth_users_id_fk'
  ) THEN
    ALTER TABLE "tenant_invitations"
      ADD CONSTRAINT "tenant_invitations_created_by_user_id_auth_users_id_fk"
      FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "tenant_invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Defense-in-depth only. The app never reads or writes this table over the
-- PostgREST (authenticated-role) path: invitation reads/redeems run through the
-- trusted server-side Drizzle connection, and the table is intentionally NOT in
-- the PowerSync publication or sync rules. These policies just keep the table
-- safe if it is ever exposed via PostgREST. The SELECT policy does let a tenant
-- member read the token through PostgREST, which is acceptable: any member is
-- already allowed to generate invitations.

DROP POLICY IF EXISTS "tenant members can read tenant invitations"
  ON "tenant_invitations";
--> statement-breakpoint
CREATE POLICY "tenant members can read tenant invitations"
ON "tenant_invitations" FOR SELECT
USING ("public"."current_user_has_tenant"("tenant_id"));
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant members can insert tenant invitations"
  ON "tenant_invitations";
--> statement-breakpoint
CREATE POLICY "tenant members can insert tenant invitations"
ON "tenant_invitations" FOR INSERT
WITH CHECK (
  "public"."current_user_has_tenant"("tenant_id")
  AND "created_by_user_id" = auth.uid()
);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant members can update tenant invitations"
  ON "tenant_invitations";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant members can revoke tenant invitations"
  ON "tenant_invitations";
--> statement-breakpoint
CREATE POLICY "tenant members can revoke tenant invitations"
ON "tenant_invitations" FOR UPDATE
USING (
  "public"."current_user_has_tenant"("tenant_id")
  AND "revoked_at" IS NULL
)
WITH CHECK (
  "public"."current_user_has_tenant"("tenant_id")
  AND "revoked_at" IS NOT NULL
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."tenant_invitations_enforce_revoke_only_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- auth.users ON DELETE SET NULL only clears created_by_user_id; skip revoke checks.
  IF OLD."created_by_user_id" IS NOT NULL
     AND NEW."created_by_user_id" IS NULL
     AND NEW."token" IS NOT DISTINCT FROM OLD."token"
     AND NEW."token_delivery_ciphertext" IS NOT DISTINCT FROM OLD."token_delivery_ciphertext"
     AND NEW."expires_at" IS NOT DISTINCT FROM OLD."expires_at"
     AND NEW."tenant_id" IS NOT DISTINCT FROM OLD."tenant_id"
     AND NEW."created_at" IS NOT DISTINCT FROM OLD."created_at"
     AND NEW."id" IS NOT DISTINCT FROM OLD."id"
     AND NEW."revoked_at" IS NOT DISTINCT FROM OLD."revoked_at"
  THEN
    RETURN NEW;
  END IF;

  IF NEW."token" IS DISTINCT FROM OLD."token"
     OR NEW."token_delivery_ciphertext" IS DISTINCT FROM OLD."token_delivery_ciphertext"
     OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
     OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR NEW."id" IS DISTINCT FROM OLD."id"
  THEN
    RAISE EXCEPTION 'tenant_invitations columns are immutable except revoked_at';
  END IF;

  IF OLD."revoked_at" IS NOT NULL THEN
    RAISE EXCEPTION 'tenant_invitations row is already revoked';
  END IF;

  IF NEW."revoked_at" IS NULL THEN
    RAISE EXCEPTION 'tenant_invitations update must set revoked_at';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "tenant_invitations_revoke_only_update"
  ON "tenant_invitations";
--> statement-breakpoint
CREATE TRIGGER "tenant_invitations_revoke_only_update"
  BEFORE UPDATE ON "tenant_invitations"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."tenant_invitations_enforce_revoke_only_update"();
