-- Run after: Drizzle migration adding tenants.created_by_user_id and tenant_invitations.
-- auth.users FKs and tenant_invitations RLS. Drizzle cannot model auth.users.
-- Run in the SQL editor after `npm run db:push` on every environment.

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

ALTER TABLE "tenant_invitations" ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth only. The app never reads or writes this table over the
-- PostgREST (authenticated-role) path: invitation reads/redeems run through the
-- trusted server-side Drizzle connection, and the table is intentionally NOT in
-- the PowerSync publication or sync rules. These policies just keep the table
-- safe if it is ever exposed via PostgREST. The SELECT policy does let a tenant
-- member read the token through PostgREST, which is acceptable: any member is
-- already allowed to generate invitations.

DROP POLICY IF EXISTS "tenant members can read tenant invitations"
  ON "tenant_invitations";

CREATE POLICY "tenant members can read tenant invitations"
ON "tenant_invitations" FOR SELECT
USING ("public"."current_user_has_tenant"("tenant_id"));

DROP POLICY IF EXISTS "tenant members can insert tenant invitations"
  ON "tenant_invitations";

CREATE POLICY "tenant members can insert tenant invitations"
ON "tenant_invitations" FOR INSERT
WITH CHECK (
  "public"."current_user_has_tenant"("tenant_id")
  AND "created_by_user_id" = auth.uid()
);

DROP POLICY IF EXISTS "tenant members can update tenant invitations"
  ON "tenant_invitations";

CREATE POLICY "tenant members can update tenant invitations"
ON "tenant_invitations" FOR UPDATE
USING ("public"."current_user_has_tenant"("tenant_id"))
WITH CHECK ("public"."current_user_has_tenant"("tenant_id"));
