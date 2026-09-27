-- Apply after `pnpm db:push` and after
-- 20260926120000_powersync_upload_convergence.sql, in the Supabase SQL
-- editor. Every statement is idempotent, so the file can be re-run.
--
-- Product edits are last-write-wins by updated_at: the time of the edit on the
-- device that made it (the app server's clock for server-action writes).
-- PowerSync devices can upload an edit hours after another device saved a
-- newer one. Without this trigger the late upload overwrote the newer edit and
-- moved updated_at back.
--
-- 1. An UPDATE whose updated_at is older than the stored one is a stale edit.
--    The trigger keeps the stored row instead of skipping the UPDATE, so the
--    statement still matches and returns the row: the uploader counts the
--    edit as done, and the device receives the newer row at the next
--    checkpoint. The whole edit is dropped, not merged field by field,
--    because a product row carries a single timestamp.
-- 2. An equal updated_at applies. A write that leaves updated_at unchanged
--    (a maintenance script, for example) is never treated as stale.
-- 3. A changed updated_at or archived_at more than 5 minutes ahead of the
--    server clock raises 55000, which the uploader retries, as the insert
--    trigger in 20260926120000 already does. Without this bound, a device
--    whose clock is far in the future would win every later edit of the
--    product until real time caught up.
--
-- Rules mirrored in TypeScript (keep them in step):
--   every product UPDATE sets updated_at -> lib/powersync/write-products.ts,
--                                           lib/products/repository.ts
--   55000 is retryable                   -> lib/powersync/connector.ts

CREATE OR REPLACE FUNCTION public.products_keep_latest_edit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.updated_at < OLD.updated_at THEN
    RETURN OLD;
  END IF;

  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    PERFORM public.check_upload_timestamp(NEW.updated_at, 'updated_at');
  END IF;

  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    PERFORM public.check_upload_timestamp(NEW.archived_at, 'archived_at');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_keep_latest_edit ON public.products;
CREATE TRIGGER products_keep_latest_edit
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.products_keep_latest_edit();

-- Trigger functions are never called directly.
REVOKE ALL ON FUNCTION public.products_keep_latest_edit() FROM PUBLIC, anon, authenticated;
