-- The triggers that guard every writer, including the server actions' direct
-- connection, which bypasses RLS: the void and refund rules, last-write-wins
-- product edits, device timestamp bounds and revoke-only invitations.

BEGIN;

\set user_a a0000000-0000-4000-8000-00000000000a
\set tenant_a a1000000-0000-4000-8000-000000000001
\set product_a a2000000-0000-4000-8000-000000000001
\set sale_1 a3000000-0000-4000-8000-000000000001
\set sale_2 a3000000-0000-4000-8000-000000000002

SELECT tests.create_user(:'user_a', 'a@example.com');
SELECT tests.create_tenant(:'tenant_a', :'user_a');
SELECT tests.create_product(:'product_a', :'tenant_a');
SELECT tests.create_sale(:'sale_1', :'tenant_a', :'user_a', :'product_a', now() - interval '1 minute');
SELECT tests.create_sale(:'sale_2', :'tenant_a', :'user_a', :'product_a', now() - interval '1 minute');

-- ---------------------------------------------------------------------------
-- Voids and refunds
-- ---------------------------------------------------------------------------

SELECT tests.throws(
  format('UPDATE public.sales SET payment_method = %L WHERE id = %L', 'qr_transfer', :'sale_1'),
  '23514',
  'a recorded sale''s fields cannot change'
);
SELECT tests.throws(
  format(
    'UPDATE public.sales SET voided_at = now() + interval %L, voided_by_user_id = %L WHERE id = %L',
    '10 minutes', :'user_a', :'sale_1'
  ),
  '23514',
  'a void more than 10 minutes after the sale is refused'
);
SELECT tests.is(
  tests.affected_rows(format(
    'UPDATE public.sales SET voided_at = now(), voided_by_user_id = %L WHERE id = %L',
    :'user_a', :'sale_1'
  )),
  1,
  'a sale is voided within 10 minutes'
);
SELECT tests.throws(
  format(
    'UPDATE public.sales SET voided_at = now(), voided_by_user_id = %L WHERE id = %L',
    :'user_a', :'sale_1'
  ),
  '23514',
  'a voided sale cannot be voided again'
);
SELECT tests.throws(
  format(
    'INSERT INTO public.refunds (tenant_id, original_sale_id, user_id, client_created_at) VALUES (%L, %L, %L, now())',
    :'tenant_a', :'sale_1', :'user_a'
  ),
  '23514',
  'a voided sale cannot be refunded'
);

INSERT INTO public.refunds (tenant_id, original_sale_id, user_id, client_created_at)
VALUES (:'tenant_a', :'sale_2', :'user_a', now());

SELECT tests.throws(
  format(
    'UPDATE public.sales SET voided_at = now(), voided_by_user_id = %L WHERE id = %L',
    :'user_a', :'sale_2'
  ),
  '23514',
  'a refunded sale cannot be voided'
);

-- ---------------------------------------------------------------------------
-- Product edits: per column, the newer updated_at wins
-- ---------------------------------------------------------------------------

\set product_b a2000000-0000-4000-8000-000000000002
\set product_c a2000000-0000-4000-8000-000000000003
\set product_d a2000000-0000-4000-8000-000000000004
\set image_1 a1000000-0000-4000-8000-000000000001/products/a2000000-0000-4000-8000-000000000002/a4000000-0000-4000-8000-000000000001.jpg
\set image_2 a1000000-0000-4000-8000-000000000001/products/a2000000-0000-4000-8000-000000000002/a4000000-0000-4000-8000-000000000002.png

SELECT tests.create_product(:'product_b', :'tenant_a');
SELECT tests.create_product(:'product_c', :'tenant_a');

UPDATE public.products SET name = 'Edición nueva', updated_at = now() + interval '2 seconds'
WHERE id = :'product_a';
SELECT tests.is(
  (SELECT name FROM public.products WHERE id = :'product_a'),
  'Edición nueva',
  'a newer edit applies'
);
SELECT tests.is(
  tests.affected_rows(format(
    'UPDATE public.products SET name = %L, price_cents = 2500, updated_at = now() + interval %L WHERE id = %L',
    'Edición vieja', '1 second', :'product_a'
  )),
  1,
  'a late product edit still matches its row, so the uploader moves on'
);
SELECT tests.is(
  (SELECT name FROM public.products WHERE id = :'product_a'),
  'Edición nueva',
  'a late edit does not overwrite a column a newer edit changed'
);
SELECT tests.is(
  (SELECT price_cents FROM public.products WHERE id = :'product_a'),
  2500,
  'a late edit still applies to the columns no newer edit changed'
);
SELECT tests.is(
  (SELECT updated_at FROM public.products WHERE id = :'product_a'),
  now() + interval '2 seconds',
  'a late edit does not move updated_at back'
);
SELECT tests.is(
  (SELECT field_updated_at FROM public.products WHERE id = :'product_a'),
  jsonb_build_object(
    'name', now() + interval '2 seconds',
    'price_cents', now() + interval '1 second'
  ),
  'each changed column records the time of the edit that changed it'
);
UPDATE public.products SET name = 'Mismo momento', updated_at = now() + interval '2 seconds'
WHERE id = :'product_a';
SELECT tests.is(
  (SELECT name FROM public.products WHERE id = :'product_a'),
  'Mismo momento',
  'an edit with the same time as the stored one applies'
);
UPDATE public.products SET category = 'Mantenimiento' WHERE id = :'product_a';
SELECT tests.is(
  (SELECT category FROM public.products WHERE id = :'product_a'),
  'Mantenimiento',
  'a write that leaves updated_at unchanged applies'
);
UPDATE public.products SET cost_cents = 100, updated_at = now() - interval '1 minute'
WHERE id = :'product_a';
SELECT tests.is(
  (SELECT cost_cents FROM public.products WHERE id = :'product_a'),
  NULL::integer,
  'an edit older than the product''s creation does not apply'
);
UPDATE public.products
SET field_updated_at = jsonb_build_object('name', now() + interval '4 minutes')
WHERE id = :'product_a';
UPDATE public.products SET name = 'Después', updated_at = now() + interval '3 seconds'
WHERE id = :'product_a';
SELECT tests.is(
  (SELECT name FROM public.products WHERE id = :'product_a'),
  'Después',
  'edit times sent by a client are ignored'
);
SELECT tests.is(
  (SELECT field_updated_at FROM public.products WHERE id = :'product_b'),
  '{}'::jsonb,
  'a new product starts without edit times'
);
INSERT INTO public.products (id, tenant_id, name, price_cents, category, field_updated_at)
VALUES (
  :'product_d', :'tenant_a', 'Con tiempos', 100, 'Stickers',
  jsonb_build_object('name', now() + interval '4 minutes')
);
SELECT tests.is(
  (SELECT field_updated_at FROM public.products WHERE id = :'product_d'),
  '{}'::jsonb,
  'a new product ignores edit times sent by a client'
);
SELECT tests.throws(
  format(
    'UPDATE public.products SET updated_at = now() + interval %L WHERE id = %L',
    '1 hour', :'product_a'
  ),
  '55000',
  'an edit from a device clock an hour ahead is retried later'
);
SELECT tests.throws(
  format(
    'UPDATE public.products SET archived_at = now() + interval %L, updated_at = now() + interval %L WHERE id = %L',
    '1 hour', '4 seconds', :'product_a'
  ),
  '55000',
  'an archive time an hour ahead is retried later'
);

-- Images

UPDATE public.products SET name = 'Renombrado', updated_at = now() + interval '2 seconds'
WHERE id = :'product_b';
UPDATE public.products SET image_path = :'image_1', updated_at = now() + interval '1 second'
WHERE id = :'product_b';
SELECT tests.is(
  (SELECT image_path FROM public.products WHERE id = :'product_b'),
  :'image_1',
  'a late image applies when the newer edit did not change the image'
);
UPDATE public.products SET image_path = :'image_2', updated_at = now() + interval '500 milliseconds'
WHERE id = :'product_b';
SELECT tests.is(
  (SELECT image_path FROM public.products WHERE id = :'product_b'),
  :'image_1',
  'an image older than the stored image is dropped'
);

-- A product last written by a device clock far ahead, before device times
-- were bounded.
SET LOCAL session_replication_role = replica;
UPDATE public.products
SET updated_at = now() + interval '1 year',
    field_updated_at = jsonb_build_object('name', now() + interval '1 year')
WHERE id = :'product_c';
SET LOCAL session_replication_role = origin;

UPDATE public.products SET name = 'Corregido', updated_at = now() + interval '3 seconds'
WHERE id = :'product_c';
SELECT tests.is(
  (SELECT name FROM public.products WHERE id = :'product_c'),
  'Corregido',
  'an edit applies over times from a clock far ahead'
);
SELECT tests.is(
  (SELECT updated_at FROM public.products WHERE id = :'product_c'),
  now() + interval '3 seconds',
  'the edit brings updated_at back from a clock far ahead'
);

-- ---------------------------------------------------------------------------
-- Device timestamps on inserts
-- ---------------------------------------------------------------------------

SELECT tests.throws(
  format(
    'INSERT INTO public.products (tenant_id, name, price_cents, category, created_at, updated_at) VALUES (%L, %L, 100, %L, now() + interval %L, now())',
    :'tenant_a', 'Futuro', 'Stickers', '1 hour'
  ),
  '55000',
  'a product created by a device clock an hour ahead is retried later'
);
SELECT tests.throws(
  format(
    'INSERT INTO public.inventory_movements (tenant_id, product_id, user_id, delta, reason, client_created_at) VALUES (%L, %L, %L, 1, %L, now() + interval %L)',
    :'tenant_a', :'product_a', :'user_a', 'restock', '1 hour'
  ),
  '55000',
  'a stock movement from a device clock an hour ahead is retried later'
);
SELECT tests.is(
  tests.affected_rows(format(
    'INSERT INTO public.inventory_movements (tenant_id, product_id, user_id, delta, reason, created_at, client_created_at) VALUES (%L, %L, %L, 1, %L, now() - interval %L, now() - interval %L)',
    :'tenant_a', :'product_a', :'user_a', 'restock', '3 days', '3 days'
  )),
  1,
  'a stock movement recorded offline days ago is accepted'
);

-- ---------------------------------------------------------------------------
-- Invitations can only be revoked
-- ---------------------------------------------------------------------------

\set invitation a6000000-0000-4000-8000-000000000001

INSERT INTO public.tenant_invitations (id, tenant_id, token, created_by_user_id, expires_at)
VALUES (:'invitation', :'tenant_a', 'hash-a', :'user_a', now() + interval '1 day');

SELECT tests.throws(
  format(
    'UPDATE public.tenant_invitations SET expires_at = now() + interval %L WHERE id = %L',
    '30 days', :'invitation'
  ),
  'P0001',
  'an invitation''s expiry cannot be extended'
);
SELECT tests.is(
  tests.affected_rows(format(
    'UPDATE public.tenant_invitations SET revoked_at = now() WHERE id = %L',
    :'invitation'
  )),
  1,
  'an invitation is revoked'
);
SELECT tests.throws(
  format(
    'UPDATE public.tenant_invitations SET revoked_at = now() WHERE id = %L',
    :'invitation'
  ),
  'P0001',
  'a revoked invitation stays revoked'
);

ROLLBACK;
