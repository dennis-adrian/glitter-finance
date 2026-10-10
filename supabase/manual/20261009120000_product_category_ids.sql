-- Apply after `pnpm db:push` has applied
--   20261010021758_product_category_id.sql (products.category_id and its
--     index, categories_id_tenant_id_unique) and
--   20261010022414_product_category_fk.sql (the composite FK; a category
--     in use cannot be deleted),
-- and after every earlier hand-written file, in particular
-- 20260814235900_categories_rls.sql, 20260814235910_category_integrity_triggers.sql,
-- 20260926130100_products_last_write_wins.sql,
-- 20260930120000_category_triggers_follow_latest_edit.sql and
-- 20260930130000_products_use_category_spelling.sql, in the Supabase SQL
-- editor, as the last step of the release, after the app build that reads
-- and writes category_id is deployed. Until it runs, products written by
-- older clients have no category_id, and that build files them under their
-- category's name. The whole file runs in one transaction and can be
-- re-run; a second run changes nothing.
--
-- Supersedes the name-based category triggers of 20260814235910,
-- 20260930120000 and 20260930130000, which may have shipped and are
-- therefore not edited: this file drops their triggers and functions. Re-run
-- it after re-running any of them.
--
-- Products reference their category by id. products.category stays, derived
-- from the id, because:
--   * v0.7.0 and v0.8.0 clients (and offline uploads queued by them) only
--     send a category NAME and read products.category;
--   * sale lines copy it as their category.
-- Invariants (docs/implementation-notes.md, Categories):
--   I1 category_id is the source of truth; category is derived from it.
--   I2 a new or changed category_id that belongs to the tenant wins over the
--      text.
--   I3 a text-only change with the same id is a move only if the text names a
--      DIFFERENT existing category or one of v0.7.0's four fixed categories.
--      Rename cascades, case and spacing variants, v0.7.0's canonicalize-on-
--      save and other stale names from replayed uploads are not moves.
--   I4 maintenance writes (rename cascade, backfill) never touch updated_at.
--      products_keep_latest_edit always applies a write that leaves
--      updated_at unchanged, so a rename reaches a product last edited by a
--      device clock ahead of the server's, and updated_at never moves back.
--
-- Mixed fleet:
--   * v0.7.0 sends one of its four fixed categories (or an alias such as
--     'Pegatinas'); a missing one is created, as a v0.7.0 insert expects.
--   * v0.8.0 sends any of the tenant's category names. Its rename uploads
--     the categories PATCH and then products PATCHes with the new name: the
--     cascade has already moved the text, and the name resolves to the same
--     id. A product it files under a category deleted on another device
--     brings that category back.
--   * A v0.7.0 or v0.8.0 delete of a category still in use fails with 23503
--     (the FK), as the name-based trigger did.
--
-- 1. Grants for the PowerSync upload path.
-- 2. products_category_resolve_id resolves category_id (I2, I3) before every
--    other products BEFORE trigger, so products_keep_latest_edit judges the
--    resolved id like any other column.
-- 3. products_sync_category_name re-derives the name after
--    products_keep_latest_edit (I1).
-- 4. categories_cascade_name_to_products renames the products of a renamed
--    category by id (I4); categories_prevent_tenant_move keeps a category in
--    its tenant (23514), whether or not the name changes too.
-- 5. Retires the name-based triggers and their functions.
-- 6. Backfills category_id and the derived names.
-- 7. Verifies; any failed check rolls the whole file back.
--
-- Names are normalized as lib/categories/validation.ts does (trim, collapse
-- spaces, at most 40 characters). A name it refuses (blank, or 'Todos' in
-- any case, the rails' show-everything filter) files the product under
-- 'Sin categoría'.
--
-- Locking: writes to products and categories wait while it runs. The first
-- run also makes reads of both tables wait until it commits, because
-- dropping a trigger locks its table; re-runs skip the drops. lock_timeout
-- makes it fail fast, and roll back, if another session holds those tables;
-- just run it again.
--
-- Rules mirrored in TypeScript (keep them in step):
--   a product's category is a category of its tenant
--                                  -> createProductForTenant,
--                                     updateProductForTenant
--                                     (lib/products/repository.ts),
--                                     createProductLocal, updateProductLocal
--                                     (lib/powersync/write-products.ts)
--   a rename renames the products  -> renameCategoryForTenant
--                                     (lib/categories/repository.ts),
--                                     renameCategoryLocal
--                                     (lib/powersync/write-categories.ts)
--   a used category is not deleted -> deleteCategoryForTenant,
--                                     deleteCategoryLocal
--   a delete that lost to another device (23503) converges
--                                  -> lib/powersync/connector.ts

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
--    ("products_category_resolve_id" sorts before
--    "products_check_upload_timestamps" and "products_keep_latest_edit").
--    The v0.7.0 aliases are only used when the exact name has no category,
--    and alias names are never created.
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
    -- NULL or unknown id (an older client, or its category upload lost a
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
    -- I3: an older client moved the product by name only if the text names
    -- another existing category (exact, then v0.7.0 alias), or is one of
    -- v0.7.0's four fixed categories (created if missing, as a v0.7.0 insert
    -- would). Anything else (rename cascade, case/spacing variant, a stale
    -- name in a replayed or concurrent upload) keeps the id;
    -- products_sync_category_name then re-derives the text.
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
  -- the v0.7.0 alias, then create the category. A name the app refuses for a
  -- category (blank, or the 'Todos' filter) becomes 'Sin categoría'.
  v_name := btrim(left(btrim(regexp_replace(coalesce(NEW.category, ''), '\s+', ' ', 'g')), 40));
  IF v_name = '' OR lower(v_name) = 'todos' THEN
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
--    "products_keep_latest_edit"), so a column the last-write-wins trigger
--    kept can never leave category and category_id naming different
--    categories.
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

-- 4. Rename cascade by id. Keeps products.category current for older clients
--    and sale lines. Leaves updated_at alone (I4); PowerSync replicates the
--    changed rows either way.
CREATE OR REPLACE FUNCTION public.categories_cascade_name_to_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
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

-- BEFORE, so it also wins over the FK's 23503 when products use the
-- category.
CREATE OR REPLACE FUNCTION public.prevent_category_tenant_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'A category cannot move between tenants'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE TRIGGER categories_prevent_tenant_move
BEFORE UPDATE OF tenant_id ON public.categories
FOR EACH ROW
WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
EXECUTE FUNCTION public.prevent_category_tenant_move();

-- Trigger functions are never called directly.
REVOKE ALL ON FUNCTION public.products_category_resolve_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.products_sync_category_name() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.categories_cascade_name_to_products() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_category_tenant_move() FROM PUBLIC, anon, authenticated;

-- 5. Retire the name-based triggers. The FK (23503) now guards category
--    deletes, step 4 replaces the name cascade and the tenant check, and
--    steps 2 and 3 replace the spelling triggers. Before the backfill, so
--    the categories it creates fire none of them. Each drop is skipped when
--    the trigger is already gone, because a drop locks the table against
--    reads too.
DO $$
DECLARE
  v_trigger record;
BEGIN
  FOR v_trigger IN
    SELECT t.tgname, t.tgrelid::regclass AS relation
    FROM pg_trigger t
    WHERE NOT t.tgisinternal
      AND (t.tgrelid, t.tgname) IN (
        ('public.categories'::regclass, 'categories_sync_name_to_products'),
        ('public.categories'::regclass, 'categories_prevent_delete_when_used'),
        ('public.categories'::regclass, 'categories_use_spelling_on_products'),
        ('public.products'::regclass, 'products_use_category_spelling')
      )
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', v_trigger.tgname, v_trigger.relation);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.sync_category_name_to_products();
DROP FUNCTION IF EXISTS public.prevent_category_delete_when_used();
DROP FUNCTION IF EXISTS public.categories_respell_products();
DROP FUNCTION IF EXISTS public.products_use_category_spelling();

-- 6. Backfill through the same triggers (one normalization implementation).
--    updated_at is untouched (I4); every updated row is re-sent by PowerSync.
--    products_keep_latest_edit is off for these statements only: it would
--    revert them on a row whose updated_at is older than its created_at
--    (a column's time defaults to created_at), and these writes are not
--    edits to judge.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.products'::regclass
      AND tgname = 'products_keep_latest_edit'
  ) THEN
    ALTER TABLE public.products DISABLE TRIGGER products_keep_latest_edit;
  END IF;
END $$;

UPDATE public.products SET category_id = NULL WHERE category_id IS NULL;

-- Heal rows written by a new build before this file ran, where an older
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.products'::regclass
      AND tgname = 'products_keep_latest_edit'
  ) THEN
    ALTER TABLE public.products ENABLE TRIGGER products_keep_latest_edit;
  END IF;
END $$;

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
    WHERE NOT tgisinternal AND tgenabled = 'O' AND tgname IN (
      'products_category_resolve_id',
      'products_sync_category_name',
      'categories_cascade_name_to_products',
      'categories_prevent_tenant_move'
    )
  ) <> 4 THEN
    RAISE EXCEPTION 'category triggers are not all installed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE NOT tgisinternal AND tgname IN (
      'categories_sync_name_to_products',
      'categories_prevent_delete_when_used',
      'categories_use_spelling_on_products',
      'products_use_category_spelling'
    )
  ) THEN
    RAISE EXCEPTION 'name-based category triggers are still installed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.products'::regclass
      AND tgname = 'products_keep_latest_edit'
      AND tgenabled <> 'O'
  ) THEN
    RAISE EXCEPTION 'products_keep_latest_edit is not enabled';
  END IF;
END $$;

COMMIT;
