-- SUPERSEDED by 20260929030700_product_category_ids.sql, which drops these
-- triggers: products now reference categories by id, the FK guards deletes,
-- and a new cascade keeps the denormalized name without bumping updated_at.
-- Kept so fresh environments replay the same history; running it again
-- after the newer file would re-add these name-based triggers, so re-run
-- 20260929030700_product_category_ids.sql afterwards if that happens.
--
-- Run after: 20260814235900_categories_rls.sql.
-- Keep name-based product rows coherent for every write path, including
-- PowerSync uploads and concurrent devices. Sales keep their historical
-- category snapshot and are deliberately not changed.

CREATE OR REPLACE FUNCTION "public"."sync_category_name_to_products"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'A category cannot move between tenants'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.products
  SET category = NEW.name, updated_at = now()
  WHERE tenant_id = OLD.tenant_id
    AND category = OLD.name;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "categories_sync_name_to_products" ON "categories";
CREATE TRIGGER "categories_sync_name_to_products"
AFTER UPDATE OF "name" ON "categories"
FOR EACH ROW
WHEN (OLD."name" IS DISTINCT FROM NEW."name")
EXECUTE FUNCTION "public"."sync_category_name_to_products"();

CREATE OR REPLACE FUNCTION "public"."prevent_category_delete_when_used"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
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

DROP TRIGGER IF EXISTS "categories_prevent_delete_when_used" ON "categories";
CREATE TRIGGER "categories_prevent_delete_when_used"
BEFORE DELETE ON "categories"
FOR EACH ROW
EXECUTE FUNCTION "public"."prevent_category_delete_when_used"();
