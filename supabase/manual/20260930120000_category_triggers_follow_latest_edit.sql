-- Apply after `pnpm db:push`, after
-- 20260814235910_category_integrity_triggers.sql and
-- 20260926130100_products_last_write_wins.sql, in the Supabase SQL editor.
-- Every statement is idempotent, so the file can be re-run.
--
-- Replaces the category trigger functions of 20260814235910, which may have
-- shipped and is therefore not edited:
--
-- 1. A rename reaches every product that names the category. The rename
--    stamped those products with now(), but products_keep_latest_edit keeps
--    a column whose last edit is newer, and a device whose clock runs up to
--    5 minutes ahead records edit times later than now(). Such a product
--    kept the old name, a category that no longer exists, which then also
--    escaped the delete check below. The products are now stamped with the
--    later of the server clock and their own updated_at, which is never older
--    than an edit time the last-write-wins trigger honours, so updated_at
--    does not move back either.
-- 2. A category cannot move to another tenant, also without a name change:
--    the trigger used to run only when the name changed.
-- 3. Both functions resolve names with an empty search_path, like the other
--    trigger functions, and no role can call them directly.
--
-- Rules mirrored in TypeScript (keep them in step):
--   a rename renames the products too  -> renameCategoryForTenant
--                                          (lib/categories/repository.ts),
--                                          renameCategoryLocal
--                                          (lib/powersync/write-categories.ts)
--   a used category is not deleted     -> deleteCategoryForTenant,
--                                          deleteCategoryLocal
--   a delete that lost to another device (23503) converges
--                                       -> lib/powersync/connector.ts

CREATE OR REPLACE FUNCTION public.sync_category_name_to_products()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A category cannot move between tenants'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.products
  SET category = NEW.name,
      updated_at = greatest(clock_timestamp(), updated_at)
  WHERE tenant_id = OLD.tenant_id
    AND category = OLD.name;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS categories_sync_name_to_products ON public.categories;
CREATE TRIGGER categories_sync_name_to_products
  AFTER UPDATE OF name, tenant_id ON public.categories
  FOR EACH ROW
  WHEN (
    OLD.name IS DISTINCT FROM NEW.name
    OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
  )
  EXECUTE FUNCTION public.sync_category_name_to_products();

CREATE OR REPLACE FUNCTION public.prevent_category_delete_when_used()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.products
    WHERE tenant_id = OLD.tenant_id
      AND category = OLD.name
  ) THEN
    RAISE EXCEPTION 'Category is still used by products'
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$$;

-- The BEFORE DELETE trigger from 20260814235910 keeps calling this function.

-- Trigger functions are never called directly.
REVOKE ALL ON FUNCTION public.sync_category_name_to_products() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_category_delete_when_used() FROM PUBLIC, anon, authenticated;
