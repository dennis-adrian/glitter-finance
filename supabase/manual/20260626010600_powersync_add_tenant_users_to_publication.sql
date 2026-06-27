-- Run after: npm run db:push (tenant_users table from Drizzle migrations).
-- Add tenant_users to the PowerSync logical replication publication when it
-- exists (cloud/staging). Safe to re-run: skips when the publication is missing
-- or tenant_users is already published.
--
-- Not a Drizzle/Supabase migration — run manually in the Supabase SQL editor
-- after `npm run db:push` when upgrading an environment whose `powersync`
-- publication predates Stage D. Fresh bootstrap already includes tenant_users;
-- see README "PowerSync setup".
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
    RAISE NOTICE 'powersync publication not found; skipping tenant_users add';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'powersync'
      AND schemaname = 'public'
      AND tablename = 'tenant_users'
  ) THEN
    RETURN;
  END IF;

  ALTER PUBLICATION powersync ADD TABLE tenant_users;
END $$;
