-- Tenant categories: who can read and write them through PostgREST, the
-- checks on their names, and the triggers that keep the products that name a
-- category in step with it (renames follow, a used category stays).

BEGIN;

\set user_a a0000000-0000-4000-8000-00000000000a
\set user_b b0000000-0000-4000-8000-00000000000b
\set tenant_a a1000000-0000-4000-8000-000000000001
\set tenant_b b1000000-0000-4000-8000-000000000001
\set category_a a5000000-0000-4000-8000-000000000001
\set category_b b5000000-0000-4000-8000-000000000001
\set product_a a2000000-0000-4000-8000-000000000001
\set product_b b2000000-0000-4000-8000-000000000001
\set sale_a a3000000-0000-4000-8000-000000000001

SELECT tests.create_user(:'user_a', 'a@example.com');
SELECT tests.create_user(:'user_b', 'b@example.com');
SELECT tests.create_tenant(:'tenant_a', :'user_a');
SELECT tests.create_tenant(:'tenant_b', :'user_b');
-- tests.create_product files every product under 'Stickers'.
INSERT INTO public.categories (id, tenant_id, name)
VALUES (:'category_a', :'tenant_a', 'Stickers'),
       (:'category_b', :'tenant_b', 'Stickers');
SELECT tests.create_product(:'product_a', :'tenant_a');
SELECT tests.create_product(:'product_b', :'tenant_b');
SELECT tests.create_sale(:'sale_a', :'tenant_a', :'user_a', :'product_a', now() - interval '1 minute');

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

SELECT tests.authenticate(:'user_a');

SELECT tests.is(
  (SELECT array_agg(id) FROM public.categories), ARRAY[:'category_a']::uuid[],
  'a member reads only their tenant''s categories'
);
SELECT tests.throws(
  format(
    'INSERT INTO public.categories (tenant_id, name) VALUES (%L, %L)',
    :'tenant_b', 'Intrusa'
  ),
  '42501',
  'a member cannot create a category in another tenant'
);
SELECT tests.is(
  tests.affected_rows(format(
    'UPDATE public.categories SET name = %L, updated_at = now() WHERE id = %L',
    'Cambiada', :'category_b'
  )),
  0,
  'a member cannot rename another tenant''s category'
);
SELECT tests.is(
  tests.affected_rows(format(
    'DELETE FROM public.categories WHERE id = %L', :'category_b'
  )),
  0,
  'a member cannot delete another tenant''s category'
);
SELECT tests.is(
  tests.affected_rows(format(
    'INSERT INTO public.categories (tenant_id, name) VALUES (%L, %L)',
    :'tenant_a', 'Pines'
  )),
  1,
  'a member creates a category in their own tenant'
);

SELECT tests.authenticate(NULL);

SELECT tests.is(
  (SELECT count(*)::int FROM public.categories), 0,
  'a request with only the publishable key reads no categories'
);

SELECT tests.as_owner();

-- ---------------------------------------------------------------------------
-- Names
-- ---------------------------------------------------------------------------

SELECT tests.throws(
  format(
    'INSERT INTO public.categories (tenant_id, name) VALUES (%L, %L)',
    :'tenant_a', '   '
  ),
  '23514',
  'a blank category name is refused'
);
SELECT tests.throws(
  format(
    'INSERT INTO public.categories (tenant_id, name) VALUES (%L, %L)',
    :'tenant_a', repeat('x', 41)
  ),
  '23514',
  'a category name over 40 characters is refused'
);
SELECT tests.throws(
  format(
    'INSERT INTO public.categories (tenant_id, name) VALUES (%L, %L)',
    :'tenant_a', 'STICKERS'
  ),
  '23505',
  'a tenant cannot have two categories whose names differ only in case'
);

-- ---------------------------------------------------------------------------
-- Renames follow onto the products
-- ---------------------------------------------------------------------------

SELECT tests.authenticate(:'user_a');

UPDATE public.categories SET name = 'Pegatinas', updated_at = now()
WHERE id = :'category_a';

SELECT tests.as_owner();

SELECT tests.is(
  (SELECT category FROM public.products WHERE id = :'product_a'),
  'Pegatinas',
  'renaming a category renames it on the tenant''s products'
);
SELECT tests.is(
  (SELECT category FROM public.products WHERE id = :'product_b'),
  'Stickers',
  'a rename leaves another tenant''s products with the same category alone'
);
SELECT tests.is(
  (SELECT category FROM public.sale_lines WHERE sale_id = :'sale_a'),
  'Stickers',
  'a sale keeps the category it was sold under'
);

-- A device whose clock runs a few minutes ahead (within the 5 minutes the
-- server accepts) moved the product into the category. The rename is newer,
-- whatever that device's clock said, and must still reach the product.
UPDATE public.products
SET category = 'Pines', updated_at = now() + interval '4 minutes'
WHERE id = :'product_a';
UPDATE public.categories SET name = 'Pins', updated_at = now()
WHERE tenant_id = :'tenant_a' AND name = 'Pines';
SELECT tests.is(
  (SELECT category FROM public.products WHERE id = :'product_a'),
  'Pins',
  'a rename reaches a product last edited by a device clock a few minutes ahead'
);
SELECT tests.is(
  (SELECT updated_at FROM public.products WHERE id = :'product_a'),
  now() + interval '4 minutes',
  'a rename does not move a product''s updated_at back'
);

SELECT tests.throws(
  format(
    'UPDATE public.categories SET tenant_id = %L WHERE id = %L',
    :'tenant_b', :'category_a'
  ),
  '23514',
  'a category cannot move to another tenant'
);

-- ---------------------------------------------------------------------------
-- A category in use stays
-- ---------------------------------------------------------------------------

UPDATE public.products SET category = 'Pegatinas', archived_at = now()
WHERE id = :'product_a';

SELECT tests.authenticate(:'user_a');

SELECT tests.throws(
  format('DELETE FROM public.categories WHERE id = %L', :'category_a'),
  '23503',
  'a category an archived product still uses cannot be deleted'
);
SELECT tests.is(
  tests.affected_rows(format(
    'DELETE FROM public.categories WHERE tenant_id = %L AND name = %L',
    :'tenant_a', 'Pins'
  )),
  1,
  'a member deletes a category no product uses'
);

SELECT tests.as_owner();

DELETE FROM public.tenants WHERE id = :'tenant_b';
SELECT tests.is(
  (SELECT count(*)::int FROM public.categories WHERE tenant_id = :'tenant_b'),
  0,
  'deleting a tenant deletes its categories, even ones its products use'
);

ROLLBACK;
