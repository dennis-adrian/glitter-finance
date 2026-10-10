-- Products reference their category by id
-- (supabase/manual/20261009120000_product_category_ids.sql): how category_id
-- is resolved for every client generation, the name derived from it, the
-- rename cascade, the delete and tenant guards, the backfill, and how the
-- triggers meet last-write-wins product edits.

BEGIN;

\set member 7e570000-0000-4000-8000-000000000001
\set outsider 7e570000-0000-4000-8000-000000000002
\set tenant_a 7e570000-0000-4000-8000-0000000000a1
\set tenant_b 7e570000-0000-4000-8000-0000000000b1
\set a_stickers 7e570000-0000-4000-8000-00000000c0a1
\set a_prints 7e570000-0000-4000-8000-00000000c0a2
\set b_pegatinas 7e570000-0000-4000-8000-00000000c0b1
\set b_stickers 7e570000-0000-4000-8000-00000000c0b2
\set a_afiches 7e570000-0000-4000-8000-00000000c4b1
\set a_tazas 7e570000-0000-4000-8000-00000000c0a3

SELECT tests.create_user(:'member', 'member@example.com');
SELECT tests.create_user(:'outsider', 'outsider@example.com');
SELECT tests.create_tenant(:'tenant_a', :'member');
SELECT tests.create_tenant(:'tenant_b', :'outsider');

INSERT INTO public.categories (id, tenant_id, name) VALUES
  (:'a_stickers', :'tenant_a', 'Stickers'),
  (:'a_prints', :'tenant_a', 'Prints'),
  (:'b_pegatinas', :'tenant_b', 'Pegatinas'),
  (:'b_stickers', :'tenant_b', 'Stickers');

-- A product as a v0.7.0 or v0.8.0 client inserts it: a category name, no id.
CREATE FUNCTION pg_temp.legacy_product(tenant_id uuid, category text, name text DEFAULT 'Producto')
RETURNS public.products
LANGUAGE sql
AS $$
  INSERT INTO public.products (tenant_id, name, price_cents, category)
  VALUES (tenant_id, name, 1000, category)
  RETURNING *
$$;

-- "<category_id> <category>", to compare both columns at once.
CREATE FUNCTION pg_temp.link(product public.products)
RETURNS text
LANGUAGE sql
AS $$ SELECT format('%s %s', product.category_id, product.category) $$;

CREATE FUNCTION pg_temp.link(category_id uuid, category text)
RETURNS text
LANGUAGE sql
AS $$ SELECT format('%s %s', category_id, category) $$;

-- ---------------------------------------------------------------------------
-- 1. An insert with only a name resolves it
-- ---------------------------------------------------------------------------

SELECT tests.is(
  pg_temp.link(pg_temp.legacy_product(:'tenant_a', 'Stickers')),
  pg_temp.link(:'a_stickers', 'Stickers'),
  'an insert with only a name links the category of that name'
);
SELECT tests.is(
  pg_temp.link(pg_temp.legacy_product(:'tenant_a', '  stickers   ')),
  pg_temp.link(:'a_stickers', 'Stickers'),
  'a case or spacing variant links the category and takes its spelling'
);

SELECT count(*) AS categories_before FROM public.categories
WHERE tenant_id = :'tenant_a' \gset
SELECT tests.is(
  pg_temp.link(pg_temp.legacy_product(:'tenant_a', 'Pegatinas')),
  pg_temp.link(:'a_stickers', 'Stickers'),
  'a v0.7.0 alias with no category of its own folds into Stickers'
);
SELECT tests.is(
  (SELECT count(*) FROM public.categories WHERE tenant_id = :'tenant_a'),
  :'categories_before'::bigint,
  'an alias never creates a category'
);
SELECT tests.is(
  pg_temp.link(pg_temp.legacy_product(:'tenant_b', 'Pegatinas')),
  pg_temp.link(:'b_pegatinas', 'Pegatinas'),
  'a category named like an alias wins over the alias'
);

SELECT tests.ok(
  (SELECT category = 'Sin categoría' AND category_id IS NOT NULL
    FROM pg_temp.legacy_product(:'tenant_a', '   ')),
  'a blank name files the product under Sin categoría'
);
SELECT tests.ok(
  (SELECT category = 'Sin categoría' AND category_id IS NOT NULL
    FROM pg_temp.legacy_product(:'tenant_a', 'TODOS')),
  'the Todos filter, in any case, files the product under Sin categoría'
);
SELECT tests.ok(
  (SELECT char_length(category) = 40 AND category_id IS NOT NULL
    FROM pg_temp.legacy_product(:'tenant_a', repeat('x', 45))),
  'a name over 40 characters is cut to 40'
);
SELECT pg_temp.legacy_product(:'tenant_a', 'Llaveros', 'P1g');
SELECT tests.ok(
  (SELECT p.category = 'Llaveros' AND c.name = 'Llaveros'
    FROM public.products p
    JOIN public.categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
    WHERE p.name = 'P1g'),
  'a name the tenant has no category for creates the category'
);

-- ---------------------------------------------------------------------------
-- 2-3. A valid id wins over the text; an unknown id falls back to the name
-- ---------------------------------------------------------------------------

INSERT INTO public.products (tenant_id, name, price_cents, category, category_id)
VALUES (:'tenant_a', 'P2', 100, 'Whatever', :'a_stickers');
SELECT tests.is(
  (SELECT pg_temp.link(p) FROM public.products p WHERE name = 'P2'),
  pg_temp.link(:'a_stickers', 'Stickers'),
  'a category_id of the tenant wins and the name is derived from it'
);

INSERT INTO public.products (tenant_id, name, price_cents, category, category_id)
VALUES (:'tenant_a', 'P3', 100, 'Prints', gen_random_uuid());
SELECT tests.is(
  (SELECT category_id FROM public.products WHERE name = 'P3'),
  :'a_prints'::uuid,
  'an unknown category_id resolves by name'
);

INSERT INTO public.products (tenant_id, name, price_cents, category, category_id)
VALUES (:'tenant_a', 'P3b', 100, 'Prints', :'b_stickers');
SELECT tests.is(
  (SELECT category_id FROM public.products WHERE name = 'P3b'),
  :'a_prints'::uuid,
  'another tenant''s category_id is never linked'
);

-- ---------------------------------------------------------------------------
-- 4. A rename keeps the category's products, renames them, creates nothing
--    and leaves updated_at alone
-- ---------------------------------------------------------------------------

-- An updated_at in the past, so a cascade that stamped it would show.
INSERT INTO public.products (tenant_id, name, price_cents, category, category_id, created_at, updated_at)
VALUES (
  :'tenant_a', 'P4', 100, 'Stickers', :'a_stickers',
  now() - interval '1 day', now() - interval '1 day'
);
SELECT count(*) AS categories_before FROM public.categories
WHERE tenant_id = :'tenant_a' \gset

CREATE TEMP TABLE rename_results (
  name text, category_id uuid, category text, updated_at timestamptz, categories bigint
);
DO $$
DECLARE
  v_name text;
BEGIN
  -- Aliases, case and spacing variants, and back.
  FOREACH v_name IN ARRAY ARRAY[
    'Pegatinas', 'Pegatina', 'Pins', 'Láminas', 'Lámina', 'stickers',
    'Mis  stickers', 'Stickers'
  ] LOOP
    UPDATE public.categories SET name = v_name
    WHERE id = '7e570000-0000-4000-8000-00000000c0a1';
    INSERT INTO rename_results
    SELECT v_name, p.category_id, p.category, p.updated_at,
      (SELECT count(*) FROM public.categories c WHERE c.tenant_id = p.tenant_id)
    FROM public.products p
    WHERE p.name = 'P4';
  END LOOP;
END $$;

SELECT tests.is(
  (SELECT count(*)::int FROM rename_results
    WHERE category_id IS DISTINCT FROM :'a_stickers' OR category <> name),
  0,
  'a rename, to aliases and case or spacing variants too, keeps the products and renames them'
);
SELECT tests.is(
  (SELECT count(*)::int FROM rename_results
    WHERE updated_at <> now() - interval '1 day'),
  0,
  'a rename leaves the products'' updated_at alone'
);
SELECT tests.is(
  (SELECT count(*)::int FROM rename_results
    WHERE categories <> :'categories_before'::bigint),
  0,
  'a rename creates no category'
);

-- ---------------------------------------------------------------------------
-- 4b. A stale name with the same id (a replayed or concurrent upload from
--     before a rename) keeps the product where it is
-- ---------------------------------------------------------------------------

INSERT INTO public.categories (id, tenant_id, name)
VALUES (:'a_afiches', :'tenant_a', 'Afiches');
INSERT INTO public.products (tenant_id, name, price_cents, category, category_id)
VALUES (:'tenant_a', 'P4b', 100, 'Afiches', :'a_afiches');
UPDATE public.categories SET name = 'Posters' WHERE id = :'a_afiches';
SELECT count(*) AS categories_before FROM public.categories
WHERE tenant_id = :'tenant_a' \gset

UPDATE public.products SET category_id = :'a_afiches', category = 'Afiches'
WHERE name = 'P4b';
SELECT tests.is(
  (SELECT pg_temp.link(p) FROM public.products p WHERE name = 'P4b'),
  pg_temp.link(:'a_afiches', 'Posters'),
  'a stale name after a rename keeps the product in its category'
);
SELECT tests.is(
  (SELECT count(*) FROM public.categories WHERE tenant_id = :'tenant_a'),
  :'categories_before'::bigint,
  'a stale name after a rename does not bring the old name back'
);

-- ---------------------------------------------------------------------------
-- 5-8. Updates from older and current clients
-- ---------------------------------------------------------------------------

SELECT pg_temp.legacy_product(:'tenant_a', 'Stickers', 'P5');

UPDATE public.products SET category = 'Prints' WHERE name = 'P5';
SELECT tests.is(
  (SELECT pg_temp.link(p) FROM public.products p WHERE name = 'P5'),
  pg_temp.link(:'a_prints', 'Prints'),
  'a name-only change to another category moves the product'
);

UPDATE public.products SET category = 'Tazas' WHERE name = 'P5';
SELECT tests.is(
  (SELECT pg_temp.link(p) FROM public.products p WHERE name = 'P5'),
  pg_temp.link(:'a_prints', 'Prints'),
  'a name-only change to a name no category has is ignored'
);
SELECT tests.ok(
  NOT EXISTS (
    SELECT 1 FROM public.categories WHERE tenant_id = :'tenant_a' AND name = 'Tazas'
  ),
  'a name-only change to a name no category has creates nothing'
);

UPDATE public.products SET category = 'Accesorios' WHERE name = 'P5';
SELECT tests.ok(
  (SELECT p.category = 'Accesorios' AND c.name = 'Accesorios'
    FROM public.products p
    JOIN public.categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
    WHERE p.name = 'P5'),
  'a v0.7.0 move into one of its fixed categories creates it when missing'
);

-- v0.7.0 saves 'Stickers' for a product it shows under 'Pegatinas'.
SELECT pg_temp.legacy_product(:'tenant_b', 'Pegatinas', 'P6');
UPDATE public.products SET category = 'Stickers' WHERE name = 'P6';
SELECT tests.is(
  (SELECT pg_temp.link(p) FROM public.products p WHERE name = 'P6'),
  pg_temp.link(:'b_pegatinas', 'Pegatinas'),
  'a v0.7.0 canonical save is not a move'
);

SELECT pg_temp.legacy_product(:'tenant_a', 'Stickers', 'P7');
UPDATE public.products SET category_id = :'a_prints', category = 'Stickers'
WHERE name = 'P7';
SELECT tests.is(
  (SELECT pg_temp.link(p) FROM public.products p WHERE name = 'P7'),
  pg_temp.link(:'a_prints', 'Prints'),
  'a change with both columns follows the id'
);

-- A row the backfill has not reached yet.
ALTER TABLE public.products DISABLE TRIGGER products_category_resolve_id;
INSERT INTO public.products (tenant_id, name, price_cents, category)
VALUES (:'tenant_a', 'P8', 100, 'prints');
ALTER TABLE public.products ENABLE TRIGGER products_category_resolve_id;
SELECT tests.is(
  (SELECT category_id FROM public.products WHERE name = 'P8'),
  NULL::uuid,
  'setup: a product with no category_id'
);
UPDATE public.products SET price_cents = 200 WHERE name = 'P8';
SELECT tests.is(
  (SELECT pg_temp.link(p) FROM public.products p WHERE name = 'P8'),
  pg_temp.link(:'a_prints', 'Prints'),
  'any update links a product that has no category_id'
);

-- ---------------------------------------------------------------------------
-- 9. A used category cannot be deleted; an unused one can
-- ---------------------------------------------------------------------------

SELECT tests.throws(
  format('DELETE FROM public.categories WHERE id = %L', :'a_prints'),
  '23503',
  'a category its products use cannot be deleted'
);
INSERT INTO public.categories (tenant_id, name) VALUES (:'tenant_a', 'Vacía');
SELECT tests.is(
  tests.affected_rows(format(
    'DELETE FROM public.categories WHERE tenant_id = %L AND name = %L',
    :'tenant_a', 'Vacía'
  )),
  1,
  'an unused category is deleted'
);

-- ---------------------------------------------------------------------------
-- A category stays in its tenant
-- ---------------------------------------------------------------------------

SELECT tests.throws(
  format(
    'UPDATE public.categories SET tenant_id = %L WHERE id = %L',
    :'tenant_b', :'a_prints'
  ),
  '23514',
  'a category its products use cannot move to another tenant'
);
SELECT tests.throws(
  format(
    'UPDATE public.categories SET tenant_id = %L, name = %L WHERE id = %L',
    :'tenant_b', 'Mudada', :'a_afiches'
  ),
  '23514',
  'a category cannot move to another tenant with a new name either'
);
INSERT INTO public.categories (tenant_id, name) VALUES (:'tenant_a', 'Sin usar');
SELECT tests.throws(
  format(
    'UPDATE public.categories SET tenant_id = %L WHERE tenant_id = %L AND name = %L',
    :'tenant_b', :'tenant_a', 'Sin usar'
  ),
  '23514',
  'an unused category cannot move to another tenant'
);

-- ---------------------------------------------------------------------------
-- 10. Through PostgREST, as the PowerSync uploader writes
-- ---------------------------------------------------------------------------

SELECT tests.authenticate(:'member');
INSERT INTO public.products (tenant_id, name, price_cents, category)
VALUES (:'tenant_a', 'P10', 100, 'Imanes QA');
UPDATE public.categories SET name = 'Imanes' WHERE tenant_id = :'tenant_a' AND name = 'Imanes QA';
SELECT tests.as_owner();

SELECT tests.ok(
  (SELECT p.category = 'Imanes' AND c.name = 'Imanes'
    FROM public.products p
    JOIN public.categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
    WHERE p.name = 'P10'),
  'a member''s insert creates its category, and a member''s rename reaches the product'
);

SELECT tests.authenticate(:'outsider');
SELECT tests.throws(
  format(
    'INSERT INTO public.products (tenant_id, name, price_cents, category) VALUES (%L, %L, 100, %L)',
    :'tenant_a', 'P10c', 'Intrusa'
  ),
  '42501',
  'a non-member cannot create a product in the tenant'
);
SELECT tests.as_owner();
SELECT tests.ok(
  NOT EXISTS (
    SELECT 1 FROM public.categories WHERE tenant_id = :'tenant_a' AND name = 'Intrusa'
  ),
  'a non-member''s refused insert creates no category'
);

-- ---------------------------------------------------------------------------
-- Last-write-wins product edits
-- ---------------------------------------------------------------------------

INSERT INTO public.products (tenant_id, name, price_cents, category, category_id, created_at, updated_at)
VALUES (
  :'tenant_a', 'LWW', 100, 'Stickers', :'a_stickers',
  now() - interval '1 hour', now() - interval '1 hour'
);
-- The current build moves it by id ...
UPDATE public.products SET category_id = :'a_prints', updated_at = now() - interval '10 minutes'
WHERE name = 'LWW';
-- ... and a v0.8.0 device uploads an older move by name afterwards.
UPDATE public.products SET category = 'Stickers', updated_at = now() - interval '30 minutes'
WHERE name = 'LWW';
SELECT tests.is(
  (SELECT pg_temp.link(p) FROM public.products p WHERE name = 'LWW'),
  pg_temp.link(:'a_prints', 'Prints'),
  'an older move by name does not undo a newer move by id'
);
SELECT tests.is(
  (SELECT updated_at FROM public.products WHERE name = 'LWW'),
  now() - interval '10 minutes',
  'an older move by name does not move updated_at back'
);

-- A device whose clock runs a few minutes ahead (within the 5 minutes the
-- server accepts) edited the product last; a rename still reaches it.
INSERT INTO public.categories (id, tenant_id, name) VALUES (:'a_tazas', :'tenant_a', 'Tazas');
INSERT INTO public.products (tenant_id, name, price_cents, category, category_id)
VALUES (:'tenant_a', 'Taza', 100, 'Tazas', :'a_tazas');
UPDATE public.products SET price_cents = 300, updated_at = now() + interval '4 minutes'
WHERE name = 'Taza';
UPDATE public.categories SET name = 'Tazones' WHERE id = :'a_tazas';
SELECT tests.is(
  (SELECT pg_temp.link(p) FROM public.products p WHERE name = 'Taza'),
  pg_temp.link(:'a_tazas', 'Tazones'),
  'a rename reaches a product last edited by a device clock a few minutes ahead'
);
SELECT tests.is(
  (SELECT updated_at FROM public.products WHERE name = 'Taza'),
  now() + interval '4 minutes',
  'a rename does not move that product''s updated_at back'
);

-- ---------------------------------------------------------------------------
-- 11. Re-running the backfill changes nothing once every row is linked.
--     Mirrors step 6 of the manual file (keep them in step).
-- ---------------------------------------------------------------------------

SELECT tests.is(
  tests.affected_rows(
    'UPDATE public.products SET category_id = NULL WHERE category_id IS NULL'
  ),
  0,
  'the backfill finds no product without a category_id'
);
SELECT tests.is(
  tests.affected_rows($sql$
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
      )
  $sql$),
  0,
  'the backfill finds no product whose name and id disagree'
);
SELECT tests.is(
  tests.affected_rows($sql$
    UPDATE public.products p
    SET category = c.name
    FROM public.categories c
    WHERE c.id = p.category_id
      AND c.tenant_id = p.tenant_id
      AND p.category IS DISTINCT FROM c.name
  $sql$),
  0,
  'the backfill finds no stale category name'
);

-- ---------------------------------------------------------------------------
-- 12. Trigger order
-- ---------------------------------------------------------------------------

-- Within a timing, triggers fire in name order: the id is resolved before
-- products_keep_latest_edit judges it, and the name is derived after.
SELECT tests.is(
  (SELECT array_agg(tgname::text ORDER BY tgname::text COLLATE "C")
    FROM pg_trigger
    WHERE tgrelid = 'public.products'::regclass
      AND NOT tgisinternal
      AND (tgtype & 2) = 2),
  ARRAY[
    'products_category_resolve_id',
    'products_check_upload_timestamps',
    'products_keep_latest_edit',
    'products_sync_category_name'
  ],
  'products BEFORE triggers resolve the id first and derive the name last, with no spelling trigger'
);
SELECT tests.is(
  (SELECT array_agg(tgname::text ORDER BY tgname::text COLLATE "C")
    FROM pg_trigger
    WHERE tgrelid = 'public.categories'::regclass
      AND NOT tgisinternal),
  ARRAY['categories_cascade_name_to_products', 'categories_prevent_tenant_move'],
  'the name-based category triggers are retired'
);

ROLLBACK;
