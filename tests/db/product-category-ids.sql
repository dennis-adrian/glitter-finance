-- Database test for supabase/manual/20260929030700_product_category_ids.sql.
--
-- Needs a local Supabase with the Drizzle migrations applied
-- (`pnpm db:local:migrate`) and the manual SQL run. Everything happens inside
-- one transaction that is rolled back, so no data is left behind:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/db/product-category-ids.sql
--
-- A failing case raises an exception naming it. "ok" lines are NOTICEs.

BEGIN;

-- Fixtures: two tenants, a member of tenant A, and a non-member.
INSERT INTO auth.users (id, email) VALUES
  ('7e570000-0000-4000-8000-000000000001', 'member@test.local'),
  ('7e570000-0000-4000-8000-000000000002', 'outsider@test.local');

INSERT INTO public.tenants (id, name) VALUES
  ('7e570000-0000-4000-8000-0000000000a1', 'Tenant A'),
  ('7e570000-0000-4000-8000-0000000000b1', 'Tenant B');

INSERT INTO public.tenant_users (tenant_id, user_id, display_name) VALUES
  ('7e570000-0000-4000-8000-0000000000a1', '7e570000-0000-4000-8000-000000000001', 'Member');

INSERT INTO public.categories (id, tenant_id, name) VALUES
  ('7e570000-0000-4000-8000-00000000c0a1', '7e570000-0000-4000-8000-0000000000a1', 'Stickers'),
  ('7e570000-0000-4000-8000-00000000c0a2', '7e570000-0000-4000-8000-0000000000a1', 'Prints'),
  ('7e570000-0000-4000-8000-00000000c0b1', '7e570000-0000-4000-8000-0000000000b1', 'Pegatinas'),
  ('7e570000-0000-4000-8000-00000000c0b2', '7e570000-0000-4000-8000-0000000000b1', 'Stickers');

CREATE TEMP TABLE t_ids (label text PRIMARY KEY, value uuid) ON COMMIT DROP;
INSERT INTO t_ids VALUES
  ('A', '7e570000-0000-4000-8000-0000000000a1'),
  ('B', '7e570000-0000-4000-8000-0000000000b1'),
  ('A.Stickers', '7e570000-0000-4000-8000-00000000c0a1'),
  ('A.Prints', '7e570000-0000-4000-8000-00000000c0a2'),
  ('B.Pegatinas', '7e570000-0000-4000-8000-00000000c0b1'),
  ('B.Stickers', '7e570000-0000-4000-8000-00000000c0b2');
GRANT SELECT ON t_ids TO authenticated;

CREATE FUNCTION pg_temp.id(p_label text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT value FROM t_ids WHERE label = p_label $$;

-- Inserts a product the way a legacy client would (name only) and returns it.
CREATE FUNCTION pg_temp.legacy_product(p_tenant uuid, p_category text)
RETURNS public.products
LANGUAGE sql AS $$
  INSERT INTO public.products (tenant_id, name, price_cents, category)
  VALUES (p_tenant, 'Test product', 1000, p_category)
  RETURNING *
$$;

-- 1. Legacy INSERT without an id resolves by name.
DO $$
DECLARE
  v public.products;
  v_before bigint;
BEGIN
  v := pg_temp.legacy_product(pg_temp.id('A'), 'Stickers');
  IF v.category_id IS DISTINCT FROM pg_temp.id('A.Stickers') OR v.category <> 'Stickers' THEN
    RAISE EXCEPTION '1a exact name: got % / %', v.category_id, v.category;
  END IF;

  v := pg_temp.legacy_product(pg_temp.id('A'), '  stickers   ');
  IF v.category_id IS DISTINCT FROM pg_temp.id('A.Stickers') OR v.category <> 'Stickers' THEN
    RAISE EXCEPTION '1b case/space variant: got % / %', v.category_id, v.category;
  END IF;

  SELECT count(*) INTO v_before FROM public.categories WHERE tenant_id = pg_temp.id('A');
  v := pg_temp.legacy_product(pg_temp.id('A'), 'Pegatinas');
  IF v.category_id IS DISTINCT FROM pg_temp.id('A.Stickers') THEN
    RAISE EXCEPTION '1c alias without an exact match should fold to Stickers, got %', v.category;
  END IF;
  IF (SELECT count(*) FROM public.categories WHERE tenant_id = pg_temp.id('A')) <> v_before THEN
    RAISE EXCEPTION '1c alias must not create a category';
  END IF;

  v := pg_temp.legacy_product(pg_temp.id('B'), 'Pegatinas');
  IF v.category_id IS DISTINCT FROM pg_temp.id('B.Pegatinas') THEN
    RAISE EXCEPTION '1d an exact Pegatinas category wins over the alias, got %', v.category;
  END IF;

  v := pg_temp.legacy_product(pg_temp.id('A'), '   ');
  IF v.category <> 'Sin categoría' OR v.category_id IS NULL THEN
    RAISE EXCEPTION '1e blank name should link to Sin categoría, got %', v.category;
  END IF;

  v := pg_temp.legacy_product(pg_temp.id('A'), repeat('x', 45));
  IF char_length(v.category) <> 40 OR v.category_id IS NULL THEN
    RAISE EXCEPTION '1f long name should be truncated to 40, got % chars', char_length(v.category);
  END IF;

  v := pg_temp.legacy_product(pg_temp.id('A'), 'Llaveros');
  IF v.category <> 'Llaveros' OR NOT EXISTS (
    SELECT 1 FROM public.categories WHERE id = v.category_id AND name = 'Llaveros'
  ) THEN
    RAISE EXCEPTION '1g unknown name should create the category';
  END IF;
  RAISE NOTICE 'ok 1 legacy inserts';
END $$;

-- 2 + 3. A valid id wins over the text; an unknown id falls back to the name.
DO $$
DECLARE
  v public.products;
BEGIN
  INSERT INTO public.products (tenant_id, name, price_cents, category, category_id)
  VALUES (pg_temp.id('A'), 'P2', 100, 'Whatever', pg_temp.id('A.Stickers'))
  RETURNING * INTO v;
  IF v.category_id IS DISTINCT FROM pg_temp.id('A.Stickers') OR v.category <> 'Stickers' THEN
    RAISE EXCEPTION '2 id should win and derive the name, got % / %', v.category_id, v.category;
  END IF;

  INSERT INTO public.products (tenant_id, name, price_cents, category, category_id)
  VALUES (pg_temp.id('A'), 'P3', 100, 'Prints', gen_random_uuid())
  RETURNING * INTO v;
  IF v.category_id IS DISTINCT FROM pg_temp.id('A.Prints') THEN
    RAISE EXCEPTION '3 unknown id should resolve by name, got %', v.category_id;
  END IF;

  -- Another tenant's category id is treated as unknown, never linked.
  INSERT INTO public.products (tenant_id, name, price_cents, category, category_id)
  VALUES (pg_temp.id('A'), 'P3b', 100, 'Prints', pg_temp.id('B.Stickers'))
  RETURNING * INTO v;
  IF v.category_id IS DISTINCT FROM pg_temp.id('A.Prints') THEN
    RAISE EXCEPTION '3b cross-tenant id must not be linked, got %', v.category_id;
  END IF;
  RAISE NOTICE 'ok 2-3 id precedence';
END $$;

-- 4. Renaming a category (including to alias names, case and spacing
--    variants) keeps its products, updates their text, creates no category,
--    and leaves updated_at alone.
DO $$
DECLARE
  v public.products;
  v_after public.products;
  v_count bigint;
  v_name text;
BEGIN
  INSERT INTO public.products (tenant_id, name, price_cents, category, category_id)
  VALUES (pg_temp.id('A'), 'P4', 100, 'Stickers', pg_temp.id('A.Stickers'))
  RETURNING * INTO v;
  -- now() is fixed inside this transaction, so start from an older
  -- updated_at; a cascade that bumped it would then be caught.
  UPDATE public.products SET updated_at = now() - interval '1 day'
  WHERE id = v.id RETURNING * INTO v;
  SELECT count(*) INTO v_count FROM public.categories WHERE tenant_id = pg_temp.id('A');

  FOREACH v_name IN ARRAY ARRAY['Pegatinas', 'Pegatina', 'Pins', 'Láminas', 'Lámina', 'stickers', 'Mis  stickers', 'Stickers'] LOOP
    UPDATE public.categories SET name = v_name WHERE id = pg_temp.id('A.Stickers');
    SELECT * INTO v_after FROM public.products WHERE id = v.id;
    IF v_after.category_id IS DISTINCT FROM pg_temp.id('A.Stickers') OR v_after.category <> v_name THEN
      RAISE EXCEPTION '4 rename to "%": product moved or text stale (% / %)', v_name, v_after.category_id, v_after.category;
    END IF;
    IF v_after.updated_at IS DISTINCT FROM v.updated_at THEN
      RAISE EXCEPTION '4 rename to "%" bumped updated_at', v_name;
    END IF;
    IF (SELECT count(*) FROM public.categories WHERE tenant_id = pg_temp.id('A')) <> v_count THEN
      RAISE EXCEPTION '4 rename to "%" created a category', v_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'ok 4 rename cascade';
END $$;

-- 4b. A stale name with an unchanged id (a replayed or concurrent upload
--     from before a rename) keeps the product in its category and creates
--     nothing.
DO $$
DECLARE
  v public.products;
  v_count bigint;
BEGIN
  INSERT INTO public.categories (id, tenant_id, name)
  VALUES ('7e570000-0000-4000-8000-00000000c4b1', pg_temp.id('A'), 'Afiches')
  RETURNING id INTO v.category_id;
  INSERT INTO public.products (tenant_id, name, price_cents, category, category_id)
  VALUES (pg_temp.id('A'), 'P4b', 100, 'Afiches', v.category_id)
  RETURNING * INTO v;
  UPDATE public.categories SET name = 'Posters' WHERE id = v.category_id;
  SELECT count(*) INTO v_count FROM public.categories WHERE tenant_id = pg_temp.id('A');

  UPDATE public.products
  SET category_id = v.category_id, category = 'Afiches'
  WHERE id = v.id RETURNING * INTO v;
  IF v.category_id <> '7e570000-0000-4000-8000-00000000c4b1' OR v.category <> 'Posters' THEN
    RAISE EXCEPTION '4b stale name moved the product: % / %', v.category_id, v.category;
  END IF;
  IF (SELECT count(*) FROM public.categories WHERE tenant_id = pg_temp.id('A')) <> v_count THEN
    RAISE EXCEPTION '4b stale name re-created a category';
  END IF;
  RAISE NOTICE 'ok 4b stale name after rename';
END $$;

-- 5-8. Updates from legacy and current clients.
DO $$
DECLARE
  v public.products;
BEGIN
  -- 5. Legacy PATCH {category} moves the product by name.
  v := pg_temp.legacy_product(pg_temp.id('A'), 'Stickers');
  UPDATE public.products SET category = 'Prints' WHERE id = v.id RETURNING * INTO v;
  IF v.category_id IS DISTINCT FROM pg_temp.id('A.Prints') OR v.category <> 'Prints' THEN
    RAISE EXCEPTION '5 legacy move by name failed: % / %', v.category_id, v.category;
  END IF;

  -- 5b. A name-only change to an unknown name that v0.7.0 can't send is
  --     ignored, never created.
  UPDATE public.products SET category = 'Tazas' WHERE id = v.id RETURNING * INTO v;
  IF v.category_id IS DISTINCT FROM pg_temp.id('A.Prints') OR v.category <> 'Prints'
     OR EXISTS (
       SELECT 1 FROM public.categories
       WHERE tenant_id = pg_temp.id('A') AND name = 'Tazas'
     ) THEN
    RAISE EXCEPTION '5b unknown name should be ignored: % / %', v.category_id, v.category;
  END IF;

  -- 5c. A v0.7.0 move into one of its fixed categories that the puesto
  --     doesn't have yet creates it, like a v0.7.0 insert would.
  UPDATE public.products SET category = 'Accesorios' WHERE id = v.id RETURNING * INTO v;
  IF v.category <> 'Accesorios' OR NOT EXISTS (
    SELECT 1 FROM public.categories
    WHERE id = v.category_id AND tenant_id = pg_temp.id('A') AND name = 'Accesorios'
  ) THEN
    RAISE EXCEPTION '5c v0.7.0 move into a missing default: % / %', v.category_id, v.category;
  END IF;

  -- 6. v0.7.0 canonicalize-on-save: {category: 'Stickers'} on a product in
  --    "Pegatinas" is not a move.
  v := pg_temp.legacy_product(pg_temp.id('B'), 'Pegatinas');
  UPDATE public.products SET category = 'Stickers' WHERE id = v.id RETURNING * INTO v;
  IF v.category_id IS DISTINCT FROM pg_temp.id('B.Pegatinas') OR v.category <> 'Pegatinas' THEN
    RAISE EXCEPTION '6 v0.7.0 canonical save moved the product: % / %', v.category_id, v.category;
  END IF;

  -- 7. PATCH with both columns: the id wins.
  v := pg_temp.legacy_product(pg_temp.id('A'), 'Stickers');
  UPDATE public.products
  SET category_id = pg_temp.id('A.Prints'), category = 'Stickers'
  WHERE id = v.id RETURNING * INTO v;
  IF v.category_id IS DISTINCT FROM pg_temp.id('A.Prints') OR v.category <> 'Prints' THEN
    RAISE EXCEPTION '7 id should win: % / %', v.category_id, v.category;
  END IF;

  -- 8. An unrelated update links a row that still has no category_id.
  ALTER TABLE public.products DISABLE TRIGGER products_category_resolve_id;
  INSERT INTO public.products (tenant_id, name, price_cents, category)
  VALUES (pg_temp.id('A'), 'P8', 100, 'prints')
  RETURNING * INTO v;
  ALTER TABLE public.products ENABLE TRIGGER products_category_resolve_id;
  IF v.category_id IS NOT NULL THEN
    RAISE EXCEPTION '8 setup: expected a NULL category_id';
  END IF;
  UPDATE public.products SET price_cents = 200 WHERE id = v.id RETURNING * INTO v;
  IF v.category_id IS DISTINCT FROM pg_temp.id('A.Prints') OR v.category <> 'Prints' THEN
    RAISE EXCEPTION '8 price update should link the row: % / %', v.category_id, v.category;
  END IF;
  RAISE NOTICE 'ok 5-8 updates';
END $$;

-- 9. Deleting a referenced category fails with 23503; an unused one deletes.
DO $$
DECLARE
  v_unused uuid;
BEGIN
  BEGIN
    DELETE FROM public.categories WHERE id = pg_temp.id('A.Prints');
    RAISE EXCEPTION '9 deleting a used category should fail';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  INSERT INTO public.categories (tenant_id, name)
  VALUES (pg_temp.id('A'), 'Vacía') RETURNING id INTO v_unused;
  DELETE FROM public.categories WHERE id = v_unused;
  IF EXISTS (SELECT 1 FROM public.categories WHERE id = v_unused) THEN
    RAISE EXCEPTION '9 unused category was not deleted';
  END IF;
  RAISE NOTICE 'ok 9 delete guard';
END $$;

-- 10. As `authenticated` (the PowerSync upload path): a member's legacy
--     insert auto-creates the category; a non-member gets 42501 and nothing
--     is created.
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '7e570000-0000-4000-8000-000000000001', 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_category_id uuid;
BEGIN
  INSERT INTO public.products (tenant_id, name, price_cents, category)
  VALUES (pg_temp.id('A'), 'P10', 100, 'Imanes QA')
  RETURNING category_id INTO v_category_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.categories WHERE id = v_category_id AND name = 'Imanes QA'
  ) THEN
    RAISE EXCEPTION '10a member insert should auto-create the category';
  END IF;

  -- Renaming as a member cascades through RLS too.
  UPDATE public.categories SET name = 'Imanes' WHERE id = v_category_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.products WHERE category_id = v_category_id AND category = 'Imanes'
  ) THEN
    RAISE EXCEPTION '10b rename cascade failed under RLS';
  END IF;
  RAISE NOTICE 'ok 10a-b member';
END $$;
RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '7e570000-0000-4000-8000-000000000002', 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.products (tenant_id, name, price_cents, category)
    VALUES (pg_temp.id('A'), 'P10c', 100, 'Intrusa');
    RAISE EXCEPTION '10c non-member insert should fail';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'ok 10c non-member rejected';
END $$;
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.categories
    WHERE tenant_id = pg_temp.id('A') AND name = 'Intrusa'
  ) THEN
    RAISE EXCEPTION '10c non-member created a category';
  END IF;
END $$;

-- 11. Re-running the backfill is a no-op once every row is linked. Mirrors
--     step 5 of the manual file (keep them in sync).
DO $$
DECLARE
  v_rows bigint;
BEGIN
  UPDATE public.products SET category_id = NULL WHERE category_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '11 backfill re-run touched % rows', v_rows;
  END IF;
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
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '11 id heal re-run touched % rows', v_rows;
  END IF;
  UPDATE public.products p
  SET category = c.name
  FROM public.categories c
  WHERE c.id = p.category_id
    AND c.tenant_id = p.tenant_id
    AND p.category IS DISTINCT FROM c.name;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '11 name heal re-run touched % rows', v_rows;
  END IF;
  RAISE NOTICE 'ok 11 backfill re-run is a no-op';
END $$;

-- 12. Trigger order: resolve runs first, name sync runs last.
DO $$
DECLARE
  v_names text[];
BEGIN
  SELECT array_agg(tgname::text ORDER BY tgname::text COLLATE "C") INTO v_names
  FROM pg_trigger
  WHERE tgrelid = 'public.products'::regclass
    AND NOT tgisinternal
    AND (tgtype & 2) = 2; -- BEFORE triggers
  IF v_names[1] <> 'products_category_resolve_id'
     OR v_names[array_length(v_names, 1)] <> 'products_sync_category_name' THEN
    RAISE EXCEPTION '12 unexpected BEFORE trigger order: %', v_names;
  END IF;
  RAISE NOTICE 'ok 12 trigger order %', v_names;
END $$;

ROLLBACK;
