-- Run after: `pnpm db:push` has applied
--   20260929030615_product_category_id.sql (products.category_id + index,
--     categories_id_tenant_id_unique) and
--   20260929030640_product_category_fk.sql (composite FK, ON DELETE RESTRICT),
-- and after the earlier categories manual files (…235900 RLS, …235930
-- publication). Supersedes 20260814235910_category_integrity_triggers.sql.
--
-- Products now reference categories by id. products.category stays as a
-- derived, denormalized name because:
--   * v0.7.0 clients (and queued offline uploads from them) only send a
--     category NAME and read products.category;
--   * sale-line category snapshots are copied from it.
-- Invariants (see docs/implementation-notes.md):
--   I1 category_id is the source of truth; category is derived from it.
--   I2 a new/changed category_id that belongs to the tenant wins over the text.
--   I3 a text-only change with the same id is a move only if the text names a
--      DIFFERENT existing category or one of v0.7.0's four fixed categories
--      (rename cascades, case/space variants, v0.7.0 canonicalize-on-save and
--      other stale names from replayed uploads are not moves).
--   I4 maintenance writes (rename cascade, backfill) never touch updated_at.
--
-- Idempotent and transactional: re-running is a no-op; any failed check rolls
-- everything back. Run the whole file at once in the SQL editor.
-- Locking: writes to products and categories wait while it runs; categories
-- reads also wait for the last few statements (retiring the old triggers).
-- lock_timeout makes it fail fast, and roll back, if another session holds
-- those tables; just run it again.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 0. Preflight: the Drizzle migrations must already be applied.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
      AND column_name = 'category_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_category_id_tenant_id_categories_id_tenant_id_fk'
  ) THEN
    RAISE EXCEPTION 'Run pnpm db:push first: products.category_id or its FK is missing';
  END IF;
END $$;

-- 1. Grants. PowerSync uploads run as `authenticated` through PostgREST, and
--    the triggers below run as the caller. RLS still limits rows to members.
--    UPDATE on categories also covers the FOR KEY SHARE lock in step 2.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;

-- 2. Resolve category_id. Runs first among products BEFORE triggers
--    ("products_category_resolve_id" sorts before a future
--    "products_check_upload_timestamps" / "products_keep_latest_edit").
--    Name normalization (trim, collapse spaces, max 40 chars) matches
--    lib/categories/validation.ts. The v0.7.0 aliases are only used when the
--    exact name has no category, and alias names are never created.
CREATE OR REPLACE FUNCTION public.products_category_resolve_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_check_id boolean;
  v_linked text;
  v_name text;
  v_alias text;
  v_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_check_id := true;
  ELSIF NEW.category_id IS NULL
     OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    v_check_id := true;
  ELSE
    v_check_id := false;
  END IF;

  IF v_check_id THEN
    -- I2: a category_id of this tenant wins. Lock it so a concurrent delete
    -- can't slip in before the FK check (KEY SHARE doesn't block renames).
    IF NEW.category_id IS NOT NULL THEN
      PERFORM 1 FROM public.categories c
      WHERE c.id = NEW.category_id AND c.tenant_id = NEW.tenant_id
      FOR KEY SHARE;
      IF FOUND THEN
        RETURN NEW;
      END IF;
    END IF;
    -- NULL or unknown id (legacy client, or its category upload lost a
    -- same-name race): fall through and resolve by name.
  ELSE
    -- Same, non-null id on UPDATE.
    IF NEW.category IS NOT DISTINCT FROM OLD.category THEN
      RETURN NEW;
    END IF;
    SELECT c.name INTO v_linked FROM public.categories c
    WHERE c.id = NEW.category_id AND c.tenant_id = NEW.tenant_id;
    -- v0.7.0 saves its canonical alias of the displayed name; not a move.
    IF v_linked IS NOT NULL AND (
         NEW.category = CASE v_linked
           WHEN 'Pegatina' THEN 'Stickers' WHEN 'Pegatinas' THEN 'Stickers'
           WHEN 'Lámina' THEN 'Prints' WHEN 'Láminas' THEN 'Prints'
           WHEN 'Pins' THEN 'Pines' ELSE NULL END
      OR NEW.category = CASE OLD.category
           WHEN 'Pegatina' THEN 'Stickers' WHEN 'Pegatinas' THEN 'Stickers'
           WHEN 'Lámina' THEN 'Prints' WHEN 'Láminas' THEN 'Prints'
           WHEN 'Pins' THEN 'Pines' ELSE NULL END
    ) THEN
      RETURN NEW;
    END IF;
    -- I3: a legacy client moved the product by name only if the text names
    -- another existing category (exact, then v0.7.0 alias), or is one of
    -- v0.7.0's four fixed categories (the only names it can send; created if
    -- missing, as a v0.7.0 insert would). Anything else (rename cascade,
    -- case/spacing variant, a stale name in a replayed or concurrent upload)
    -- keeps the id; products_sync_category_name then re-derives the text.
    v_name := btrim(left(btrim(regexp_replace(coalesce(NEW.category, ''), '\s+', ' ', 'g')), 40));
    SELECT c.id INTO v_id FROM public.categories c
    WHERE c.tenant_id = NEW.tenant_id AND lower(c.name) = lower(v_name)
    LIMIT 1;
    IF v_id IS NULL THEN
      v_alias := CASE v_name
        WHEN 'Pegatina' THEN 'Stickers' WHEN 'Pegatinas' THEN 'Stickers'
        WHEN 'Lámina' THEN 'Prints' WHEN 'Láminas' THEN 'Prints'
        WHEN 'Pins' THEN 'Pines' ELSE NULL END;
      IF v_alias IS NOT NULL THEN
        SELECT c.id INTO v_id FROM public.categories c
        WHERE c.tenant_id = NEW.tenant_id AND lower(c.name) = lower(v_alias)
        LIMIT 1;
      END IF;
    END IF;
    IF v_id IS NOT NULL THEN
      NEW.category_id := v_id;
      RETURN NEW;
    END IF;
    IF v_name NOT IN ('Stickers', 'Prints', 'Pines', 'Accesorios') THEN
      RETURN NEW;
    END IF;
    -- Fall through: create the missing v0.7.0 category and move there.
  END IF;

  -- NULL or unknown id: resolve by name, exact (case-insensitive) first, then
  -- the v0.7.0 alias, then create the category.
  v_name := btrim(left(btrim(regexp_replace(coalesce(NEW.category, ''), '\s+', ' ', 'g')), 40));
  IF v_name = '' THEN
    v_name := 'Sin categoría';
  END IF;

  SELECT c.id INTO v_id FROM public.categories c
  WHERE c.tenant_id = NEW.tenant_id AND lower(c.name) = lower(v_name)
  LIMIT 1;

  IF v_id IS NULL THEN
    v_alias := CASE v_name
      WHEN 'Pegatina' THEN 'Stickers' WHEN 'Pegatinas' THEN 'Stickers'
      WHEN 'Lámina' THEN 'Prints' WHEN 'Láminas' THEN 'Prints'
      WHEN 'Pins' THEN 'Pines' ELSE NULL END;
    IF v_alias IS NOT NULL THEN
      v_name := v_alias;
      SELECT c.id INTO v_id FROM public.categories c
      WHERE c.tenant_id = NEW.tenant_id AND lower(c.name) = lower(v_name)
      LIMIT 1;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    -- DO NOTHING (never DO UPDATE: that would rename the category and fire
    -- the cascade). On conflict nothing is returned, so select the winner.
    INSERT INTO public.categories (tenant_id, name)
    VALUES (NEW.tenant_id, v_name)
    ON CONFLICT (tenant_id, lower(name)) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      SELECT c.id INTO v_id FROM public.categories c
      WHERE c.tenant_id = NEW.tenant_id AND lower(c.name) = lower(v_name)
      LIMIT 1;
    END IF;
    IF v_id IS NULL THEN
      -- The conflicting row isn't visible yet: retryable, not fatal.
      RAISE EXCEPTION 'category resolution raced for %', v_name
        USING ERRCODE = '40001';
    END IF;
  END IF;

  NEW.category_id := v_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER products_category_resolve_id
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.products_category_resolve_id();

-- 3. Derive the name from the id (I1). Runs last among products BEFORE
--    triggers ("products_sync_category_name" sorts after
--    "products_keep_latest_edit"), so a last-write-wins trigger can never
--    leave category and category_id pointing at different categories.
CREATE OR REPLACE FUNCTION public.products_sync_category_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_name text;
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT c.name INTO v_name FROM public.categories c
    WHERE c.id = NEW.category_id AND c.tenant_id = NEW.tenant_id;
    IF v_name IS NOT NULL AND NEW.category IS DISTINCT FROM v_name THEN
      NEW.category := v_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER products_sync_category_name
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.products_sync_category_name();

-- 4. Rename cascade by id. Keeps products.category current for old clients
--    and server sale snapshots. Doesn't bump updated_at (I4); PowerSync
--    replicates the changed rows either way.
CREATE OR REPLACE FUNCTION public.categories_cascade_name_to_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'A category cannot move between tenants'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.products
  SET category = NEW.name
  WHERE tenant_id = NEW.tenant_id
    AND category_id = NEW.id
    AND category IS DISTINCT FROM NEW.name;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER categories_cascade_name_to_products
AFTER UPDATE OF name ON public.categories
FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name)
EXECUTE FUNCTION public.categories_cascade_name_to_products();

-- Trigger functions aren't RPCs; keep them unexecutable directly.
REVOKE ALL ON FUNCTION public.products_category_resolve_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.products_sync_category_name() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.categories_cascade_name_to_products() FROM PUBLIC, anon, authenticated;

-- 5. Backfill through the same triggers (one normalization implementation).
--    updated_at is untouched (I4); every updated row is re-sent by PowerSync.
UPDATE public.products SET category_id = NULL WHERE category_id IS NULL;

-- Heal rows written by a new build before this file ran, where an old
-- client later changed only the text: if the text names another existing
-- category, trust the text; otherwise trust the id.
UPDATE public.products p
SET category_id = NULL
WHERE p.category_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.id = p.category_id
      AND lower(c.name) <> lower(btrim(regexp_replace(p.category, '\s+', ' ', 'g')))
  )
  AND EXISTS (
    SELECT 1 FROM public.categories c2
    WHERE c2.tenant_id = p.tenant_id
      AND lower(c2.name) = lower(btrim(regexp_replace(p.category, '\s+', ' ', 'g')))
  );

UPDATE public.products p
SET category = c.name
FROM public.categories c
WHERE c.id = p.category_id
  AND c.tenant_id = p.tenant_id
  AND p.category IS DISTINCT FROM c.name;

-- 6. Retire the name-based integrity triggers (superseded file
--    20260814235910). The FK (RESTRICT) now guards category deletes and step 4
--    replaces the name cascade. Done last because dropping a trigger locks the
--    table against reads too; skipped when already gone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.categories'::regclass
      AND tgname IN ('categories_sync_name_to_products', 'categories_prevent_delete_when_used')
  ) THEN
    DROP TRIGGER IF EXISTS categories_sync_name_to_products ON public.categories;
    DROP TRIGGER IF EXISTS categories_prevent_delete_when_used ON public.categories;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.sync_category_name_to_products();
DROP FUNCTION IF EXISTS public.prevent_category_delete_when_used();

-- 7. Verify. Any failure rolls the whole file back.
DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.products WHERE category_id IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION '% products still have no category_id', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.products p
  JOIN public.categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
  WHERE p.category IS DISTINCT FROM c.name;
  IF v_count > 0 THEN
    RAISE EXCEPTION '% products have a category name that disagrees with category_id', v_count;
  END IF;

  IF (
    SELECT count(*) FROM pg_trigger
    WHERE NOT tgisinternal AND tgname IN (
      'products_category_resolve_id',
      'products_sync_category_name',
      'categories_cascade_name_to_products'
    )
  ) <> 3 THEN
    RAISE EXCEPTION 'category triggers are not all installed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE NOT tgisinternal AND tgname IN (
      'categories_sync_name_to_products',
      'categories_prevent_delete_when_used'
    )
  ) THEN
    RAISE EXCEPTION 'name-based category triggers are still installed';
  END IF;
END $$;

COMMIT;
