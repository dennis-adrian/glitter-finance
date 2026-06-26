-- Add tenant_users to the PowerSync logical replication publication when it
-- exists (cloud/staging). Local `supabase db reset` skips this quietly when
-- the publication has not been bootstrapped yet — see README PowerSync setup.
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
