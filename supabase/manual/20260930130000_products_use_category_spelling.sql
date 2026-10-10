-- Apply after `pnpm db:push`, after
-- 20260926130100_products_last_write_wins.sql and
-- 20260930120000_category_triggers_follow_latest_edit.sql, in the Supabase SQL
-- editor. Every statement is idempotent, so the file can be re-run.
--
-- A product whose category matches one of its tenant's categories ignoring
-- case is stored with that category's spelling.
--
-- Category names are unique per tenant ignoring case
-- (categories_tenant_name_unique), but the rename and delete triggers
-- (20260930120000) and the app match a product's category by its exact
-- spelling. Products could still arrive spelled otherwise:
-- - a device offline creates 'dulces' and files products under it while
--   another creates 'Dulces'. The uploader drops the create that reaches the
--   server second (isLostCategoryConflict in lib/powersync/connector.ts) but
--   still uploads its products, with that device's spelling. A dropped rename
--   moves its products to the name in the same way;
-- - a product left under a name no category has (its category was deleted on
--   another device) meets a category created or renamed later in another
--   case;
-- - a catalog from before categories spelled one name several ways, and the
--   backfill (ensureCategoriesForExistingProducts) created one category for
--   all of them.
-- Such a product counted for no category: its category could be deleted or
-- renamed without it, and the category rails listed its spelling as another
-- category.
--
-- 1. Every product INSERT, and every UPDATE that sets category, takes the
--    tenant's spelling. The trigger sorts after products_keep_latest_edit,
--    so it spells the value that trigger kept.
-- 2. Creating or renaming a category respells the products that match it.
--    It runs after categories_sync_name_to_products, which moves the
--    products of the old name, and leaves updated_at alone, so the
--    last-write-wins trigger always applies it (a write that keeps
--    updated_at is never older than the stored times).
-- 3. A one-off UPDATE respells the products already stored otherwise.
--
-- Both functions run with the caller's rights, like the other category
-- triggers: RLS already limits the caller to the tenant's own rows.
--
-- Rules mirrored in TypeScript (keep them in step):
--   a product takes its tenant's spelling -> resolveCategoryNameForTenant
--                                             (lib/categories/repository.ts),
--                                             resolveCategoryNameLocal
--                                             (lib/powersync/write-categories.ts)

CREATE OR REPLACE FUNCTION public.products_use_category_spelling()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  spelling text;
BEGIN
  SELECT c.name INTO spelling
  FROM public.categories c
  WHERE c.tenant_id = NEW.tenant_id
    AND lower(c.name) = lower(NEW.category)
  LIMIT 1;

  IF spelling IS NOT NULL AND spelling IS DISTINCT FROM NEW.category THEN
    NEW.category := spelling;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_use_category_spelling ON public.products;
CREATE TRIGGER products_use_category_spelling
  BEFORE INSERT OR UPDATE OF category ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.products_use_category_spelling();

CREATE OR REPLACE FUNCTION public.categories_respell_products()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
    RETURN NULL;
  END IF;

  UPDATE public.products
  SET category = NEW.name
  WHERE tenant_id = NEW.tenant_id
    AND lower(category) = lower(NEW.name)
    AND category <> NEW.name;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS categories_use_spelling_on_products ON public.categories;
CREATE TRIGGER categories_use_spelling_on_products
  AFTER INSERT OR UPDATE OF name ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.categories_respell_products();

-- Trigger functions are never called directly.
REVOKE ALL ON FUNCTION public.products_use_category_spelling() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.categories_respell_products() FROM PUBLIC, anon, authenticated;

-- Products stored before this file ran.
UPDATE public.products p
SET category = c.name
FROM public.categories c
WHERE c.tenant_id = p.tenant_id
  AND lower(c.name) = lower(p.category)
  AND p.category <> c.name;
