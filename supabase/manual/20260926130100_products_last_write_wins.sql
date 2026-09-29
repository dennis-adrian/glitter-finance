-- Apply after `pnpm db:push`, which adds products.field_updated_at
-- (20260929000106_products_field_updated_at.sql), and after
-- 20260926120000_powersync_upload_convergence.sql, in the Supabase SQL
-- editor. Every statement is idempotent, so the file can be re-run.
--
-- Product edits are last-write-wins per column, by updated_at: the time of the
-- edit on the device that made it (the app server's clock for server-action
-- writes). PowerSync devices can upload an edit hours after another device
-- saved a newer one, and a PowerSync PATCH carries only the columns the device
-- changed. Without this trigger the late upload overwrote the newer edit and
-- moved updated_at back.
--
-- 1. products.field_updated_at holds, for each column, the updated_at of the
--    edit that last changed it. A column missing from it counts as changed at
--    created_at: it has not changed since the product was created, or since
--    this file was first run. An UPDATE changes a column only if its
--    updated_at is not older than that column's time: a column a newer edit
--    changed keeps its stored value, and the rest of the edit still applies.
--    A late price change is kept when the newer edit only renamed the
--    product, and a late image is kept when the newer edit did not change the
--    image.
-- 2. The UPDATE is never skipped, so the statement still matches and returns
--    the row: the uploader counts the edit as done, and the device receives
--    the merged row at the next checkpoint. An equal time applies, and
--    updated_at never moves back: it stays the time of the newest edit. A
--    write that leaves updated_at unchanged (a maintenance script, for
--    example) is never older than the stored times.
-- 3. A changed updated_at or archived_at more than 5 minutes ahead of the
--    server clock raises 55000, which the uploader retries, as the insert
--    trigger in 20260926120000 already does. Without this bound, a device
--    whose clock is far in the future would win every later edit of the
--    product until real time caught up. A stored time beyond the bound was
--    written before it existed, by such a device, and is ignored; otherwise
--    that product would ignore every edit until real time caught up.
-- 4. A placeholder (or NULL) never replaces an uploaded image, whatever the
--    times: images change only through uploads, and the app has no way to
--    remove one. A device whose copy of the row is stale can still send a
--    placeholder tone over an image another device uploaded; the tone is
--    dropped, and the uploader then sees that the image stayed and deletes
--    nothing.
-- 5. Only this trigger writes field_updated_at: a value sent by a client is
--    ignored, and a new product starts with none.
--
-- Rules mirrored in TypeScript (keep them in step):
--   every product UPDATE sets updated_at -> lib/powersync/write-products.ts,
--                                           lib/products/repository.ts
--   55000 is retryable                   -> lib/powersync/connector.ts
--   placeholders never replace images    -> updateProductLocal,
--                                           updateProductForTenant and
--                                           unreferencedProductImagePaths
--   the 'placeholder:' prefix            -> lib/product-image-config.ts

CREATE OR REPLACE FUNCTION public.products_keep_latest_edit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  -- Stored times later than this predate the bound on device times (rule 3).
  horizon constant timestamptz := clock_timestamp() + interval '5 minutes';
  old_row jsonb;
  new_row jsonb;
  edit_times jsonb;
  field text;
  field_time timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.field_updated_at := '{}';
    RETURN NEW;
  END IF;

  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    PERFORM public.check_upload_timestamp(NEW.updated_at, 'updated_at');
  END IF;

  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    PERFORM public.check_upload_timestamp(NEW.archived_at, 'archived_at');
  END IF;

  -- Rule 4: a placeholder never replaces an uploaded image.
  IF (NEW.image_path IS NULL OR NEW.image_path LIKE 'placeholder:%')
     AND OLD.image_path IS NOT NULL
     AND OLD.image_path NOT LIKE 'placeholder:%' THEN
    NEW.image_path := OLD.image_path;
  END IF;

  old_row := to_jsonb(OLD);
  new_row := to_jsonb(NEW);
  edit_times := OLD.field_updated_at;

  -- Every column but the row's identity and bookkeeping, so a column added
  -- later is covered too.
  FOR field IN
    SELECT key
    FROM jsonb_object_keys(new_row) AS key
    WHERE key NOT IN (
      'id', 'tenant_id', 'created_at', 'updated_at', 'field_updated_at'
    )
  LOOP
    CONTINUE WHEN new_row -> field IS NOT DISTINCT FROM old_row -> field;

    field_time := coalesce((edit_times ->> field)::timestamptz, OLD.created_at);
    IF field_time > horizon THEN
      field_time := '-infinity';
    END IF;

    IF NEW.updated_at < field_time THEN
      new_row := jsonb_set(new_row, ARRAY[field], old_row -> field);
    ELSE
      edit_times := jsonb_set(edit_times, ARRAY[field], to_jsonb(NEW.updated_at));
    END IF;
  END LOOP;

  NEW := jsonb_populate_record(NEW, new_row);
  NEW.field_updated_at := edit_times;

  IF NEW.updated_at < OLD.updated_at AND OLD.updated_at <= horizon THEN
    NEW.updated_at := OLD.updated_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_keep_latest_edit ON public.products;
CREATE TRIGGER products_keep_latest_edit
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.products_keep_latest_edit();

-- Trigger functions are never called directly.
REVOKE ALL ON FUNCTION public.products_keep_latest_edit() FROM PUBLIC, anon, authenticated;
