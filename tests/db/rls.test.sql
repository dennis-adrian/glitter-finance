-- Tenant isolation through PostgREST: what a signed-in member of one tenant,
-- and a request with only the publishable key, can read and write.

BEGIN;

\set user_a a0000000-0000-4000-8000-00000000000a
\set user_b b0000000-0000-4000-8000-00000000000b
\set tenant_a a1000000-0000-4000-8000-000000000001
\set tenant_b b1000000-0000-4000-8000-000000000001
\set product_a a2000000-0000-4000-8000-000000000001
\set product_b b2000000-0000-4000-8000-000000000001
\set sale_a a3000000-0000-4000-8000-000000000001
\set sale_b b3000000-0000-4000-8000-000000000001

SELECT tests.create_user(:'user_a', 'a@example.com');
SELECT tests.create_user(:'user_b', 'b@example.com');
SELECT tests.create_tenant(:'tenant_a', :'user_a');
SELECT tests.create_tenant(:'tenant_b', :'user_b');
SELECT tests.create_product(:'product_a', :'tenant_a');
SELECT tests.create_product(:'product_b', :'tenant_b');
SELECT tests.create_sale(:'sale_a', :'tenant_a', :'user_a', :'product_a');
SELECT tests.create_sale(:'sale_b', :'tenant_b', :'user_b', :'product_b');
INSERT INTO public.refunds (tenant_id, original_sale_id, user_id, client_created_at)
VALUES (:'tenant_b', :'sale_b', :'user_b', now());
INSERT INTO public.inventory_movements (tenant_id, product_id, user_id, delta, reason, client_created_at)
VALUES (:'tenant_b', :'product_b', :'user_b', 5, 'initial', now());
INSERT INTO public.tenant_invitations (tenant_id, token, created_by_user_id, expires_at)
VALUES (:'tenant_b', 'hash-b', :'user_b', now() + interval '1 day');

SELECT tests.is(
  (SELECT count(*)::int FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity),
  0,
  'every public table has RLS enabled'
);

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

SELECT tests.authenticate(:'user_a');

SELECT tests.is(
  (SELECT array_agg(id) FROM public.tenants), ARRAY[:'tenant_a']::uuid[],
  'a member reads only their own tenant'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.tenant_users WHERE tenant_id = :'tenant_b'), 0,
  'a member cannot list another tenant''s members'
);
SELECT tests.is(
  (SELECT array_agg(id) FROM public.products), ARRAY[:'product_a']::uuid[],
  'a member reads only their tenant''s products'
);
SELECT tests.is(
  (SELECT array_agg(id) FROM public.sales), ARRAY[:'sale_a']::uuid[],
  'a member reads only their tenant''s sales'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.sale_lines WHERE tenant_id = :'tenant_b'), 0,
  'a member cannot read another tenant''s sale lines'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.refunds), 0,
  'a member cannot read another tenant''s refunds'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.inventory_movements), 0,
  'a member cannot read another tenant''s stock movements'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.tenant_invitations), 0,
  'a member cannot read another tenant''s invitations'
);

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

SELECT tests.throws(
  format(
    'INSERT INTO public.products (tenant_id, name, price_cents, category) VALUES (%L, %L, 100, %L)',
    :'tenant_b', 'Intruso', 'Stickers'
  ),
  '42501',
  'a member cannot create a product in another tenant'
);
SELECT tests.is(
  tests.affected_rows(format(
    'UPDATE public.products SET name = %L WHERE id = %L', 'Cambiado', :'product_b'
  )),
  0,
  'a member cannot edit another tenant''s product'
);
SELECT tests.is(
  tests.affected_rows(format(
    'UPDATE public.products SET name = %L WHERE id = %L', 'Cambiado', :'product_a'
  )),
  1,
  'a member edits their own tenant''s product'
);
SELECT tests.is(
  tests.affected_rows(format(
    'DELETE FROM public.products WHERE id = %L', :'product_a'
  )),
  0,
  'products cannot be deleted, not even in the member''s tenant'
);
SELECT tests.throws(
  format(
    'INSERT INTO public.tenant_users (tenant_id, user_id, display_name) VALUES (%L, %L, %L)',
    :'tenant_b', :'user_a', 'Intruso'
  ),
  '42501',
  'a user cannot join a tenant by inserting a membership'
);
SELECT tests.throws(
  format(
    'INSERT INTO public.inventory_movements (tenant_id, product_id, user_id, delta, reason, client_created_at) VALUES (%L, %L, %L, 1, %L, now())',
    :'tenant_b', :'product_b', :'user_a', 'restock'
  ),
  '42501',
  'a member cannot record stock in another tenant'
);
SELECT tests.throws(
  format(
    'INSERT INTO public.inventory_movements (tenant_id, product_id, user_id, delta, reason, client_created_at) VALUES (%L, %L, %L, 1, %L, now())',
    :'tenant_a', :'product_a', :'user_b', 'restock'
  ),
  '42501',
  'a member cannot record stock in another user''s name'
);
SELECT tests.is(
  tests.affected_rows(format(
    'INSERT INTO public.inventory_movements (tenant_id, product_id, user_id, delta, reason, client_created_at) VALUES (%L, %L, %L, 1, %L, now())',
    :'tenant_a', :'product_a', :'user_a', 'restock'
  )),
  1,
  'a member records stock in their own tenant'
);
SELECT tests.throws(
  format(
    'INSERT INTO public.sales (tenant_id, user_id, payment_method, client_created_at) VALUES (%L, %L, %L, now())',
    :'tenant_a', :'user_a', 'cash'
  ),
  '42501',
  'sales are written only through the RPC, never inserted directly'
);
SELECT tests.throws(
  format(
    'UPDATE public.sales SET voided_at = now(), voided_by_user_id = %L WHERE id = %L',
    :'user_a', :'sale_a'
  ),
  '42501',
  'sales are voided only through the RPC, never updated directly'
);
SELECT tests.throws(
  format(
    'INSERT INTO public.refunds (tenant_id, original_sale_id, user_id, client_created_at) VALUES (%L, %L, %L, now())',
    :'tenant_a', :'sale_a', :'user_a'
  ),
  '42501',
  'refunds are written only through the RPC, never inserted directly'
);

-- ---------------------------------------------------------------------------
-- Product images in Storage
-- ---------------------------------------------------------------------------

SELECT tests.is(
  tests.affected_rows(format(
    'INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)',
    'product-images',
    :'tenant_a' || '/products/' || :'product_a' || '/c4000000-0000-4000-8000-000000000001.jpg'
  )),
  1,
  'a member uploads a product image to their tenant''s folder'
);
SELECT tests.throws(
  format(
    'INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)',
    'product-images',
    :'tenant_b' || '/products/' || :'product_b' || '/c4000000-0000-4000-8000-000000000002.jpg'
  ),
  '42501',
  'a member cannot upload to another tenant''s folder'
);
SELECT tests.throws(
  format(
    'INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)',
    'product-images', :'tenant_a' || '/logo.gif'
  ),
  '42501',
  'an upload outside the product image path shape is refused, not a cast error'
);

SELECT tests.as_owner();
INSERT INTO storage.objects (bucket_id, name)
VALUES (
  'product-images',
  :'tenant_b' || '/products/' || :'product_b' || '/c4000000-0000-4000-8000-000000000003.png'
);
SELECT tests.authenticate(:'user_a');

SELECT tests.is(
  tests.affected_rows(format(
    'DELETE FROM storage.objects WHERE name LIKE %L', :'tenant_b' || '/%'
  )),
  0,
  'a member cannot delete another tenant''s images'
);
SELECT tests.is(
  tests.affected_rows(format(
    'DELETE FROM storage.objects WHERE name LIKE %L', :'tenant_a' || '/%'
  )),
  1,
  'a member deletes their tenant''s images'
);

-- ---------------------------------------------------------------------------
-- Publishable key only
-- ---------------------------------------------------------------------------

SELECT tests.authenticate(NULL);

SELECT tests.is(
  (SELECT count(*)::int FROM public.products)
    + (SELECT count(*)::int FROM public.sales)
    + (SELECT count(*)::int FROM public.tenants)
    + (SELECT count(*)::int FROM public.tenant_users),
  0,
  'without a session nothing is readable'
);
SELECT tests.throws(
  format(
    'INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)',
    'product-images',
    :'tenant_a' || '/products/' || :'product_a' || '/c4000000-0000-4000-8000-000000000004.jpg'
  ),
  '42501',
  'without a session no image can be uploaded'
);
SELECT tests.throws(
  format('SELECT public.powersync_create_sale(%L, %L)', '{}', '[]'),
  '42501',
  'without a session the financial RPCs cannot be called'
);
SELECT tests.throws(
  format('SELECT public.powersync_void_sale(%L, %L, now())', :'sale_a', :'user_a'),
  '42501',
  'without a session a sale cannot be voided'
);

ROLLBACK;
