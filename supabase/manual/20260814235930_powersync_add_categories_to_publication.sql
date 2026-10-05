-- Run after: 20260814235900_categories_rls.sql.
-- Safe to re-run and safe when the PowerSync publication is not installed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
    RAISE NOTICE 'powersync publication not found; skipping categories add';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'powersync'
      AND schemaname = 'public'
      AND tablename = 'categories'
  ) THEN
    RETURN;
  END IF;

  ALTER PUBLICATION powersync ADD TABLE public.categories;
END $$;
