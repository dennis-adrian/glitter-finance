-- Add inventory_movements to the PowerSync logical replication publication
-- when it exists (cloud/staging). Safe to re-run: skips when the publication
-- is missing or inventory_movements is already published.
--
-- Not a Drizzle/Supabase migration — run manually in the Supabase SQL editor
-- after `npm run db:push` when upgrading an environment whose `powersync`
-- publication predates inventory tracking. Fresh bootstrap already includes
-- inventory_movements; see README "PowerSync setup".
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
    RAISE NOTICE 'powersync publication not found; skipping inventory_movements add';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'powersync'
      AND schemaname = 'public'
      AND tablename = 'inventory_movements'
  ) THEN
    RETURN;
  END IF;

  ALTER PUBLICATION powersync ADD TABLE inventory_movements;
END $$;
