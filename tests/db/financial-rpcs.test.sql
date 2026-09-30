-- The PowerSync upload RPCs for sales, voids and refunds
-- (supabase/manual/20260926120000_powersync_upload_convergence.sql): retries
-- are idempotent, uploads are checked against the signed-in member, and a
-- void and a refund of the same sale converge on whichever arrived first.

BEGIN;

\set user_a a0000000-0000-4000-8000-00000000000a
\set user_b b0000000-0000-4000-8000-00000000000b
\set tenant_a a1000000-0000-4000-8000-000000000001
\set tenant_b b1000000-0000-4000-8000-000000000001
\set product_a a2000000-0000-4000-8000-000000000001
\set product_b b2000000-0000-4000-8000-000000000001
\set sale_b b3000000-0000-4000-8000-000000000001

SELECT tests.create_user(:'user_a', 'a@example.com');
SELECT tests.create_user(:'user_b', 'b@example.com');
SELECT tests.create_tenant(:'tenant_a', :'user_a');
SELECT tests.create_tenant(:'tenant_b', :'user_b');
SELECT tests.create_product(:'product_a', :'tenant_a');
SELECT tests.create_product(:'product_b', :'tenant_b');
SELECT tests.create_sale(:'sale_b', :'tenant_b', :'user_b', :'product_b');

-- Payloads shaped like the connector's (lib/powersync/upload-plan.ts): two
-- units of a 15 Bs product, recorded a minute ago.
CREATE FUNCTION tests.sale_row(
  id uuid,
  user_id uuid = 'a0000000-0000-4000-8000-00000000000a',
  tenant_id uuid = 'a1000000-0000-4000-8000-000000000001',
  sale_discount_cents jsonb = '0',
  created_at timestamptz = now() - interval '1 minute'
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'id', id,
    'tenant_id', tenant_id,
    'user_id', user_id,
    'payment_method', 'cash',
    'sale_discount_cents', sale_discount_cents,
    'created_at', created_at,
    'client_created_at', created_at
  );
$$;

CREATE FUNCTION tests.line_rows(
  sale_id uuid,
  line_id uuid = gen_random_uuid(),
  product_id uuid = 'a2000000-0000-4000-8000-000000000001',
  quantity jsonb = '2',
  line_total_cents jsonb = '3000',
  created_at timestamptz = now() - interval '1 minute'
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_array(jsonb_build_object(
    'id', line_id,
    'sale_id', sale_id,
    'tenant_id', 'a1000000-0000-4000-8000-000000000001',
    'product_id', product_id,
    'product_name', 'Sticker',
    'category', 'Stickers',
    'quantity', quantity,
    'unit_price_cents', 1500,
    'unit_cost_cents', NULL,
    'line_discount_cents', 0,
    'line_total_cents', line_total_cents,
    'created_at', created_at
  ));
$$;

CREATE FUNCTION tests.create_sale_call(sale jsonb, lines jsonb)
RETURNS text
LANGUAGE sql
AS $$
  SELECT format('SELECT public.powersync_create_sale(%L, %L)', sale, lines);
$$;

CREATE FUNCTION tests.refund_row(
  id uuid,
  original_sale_id uuid,
  user_id uuid = 'a0000000-0000-4000-8000-00000000000a',
  tenant_id uuid = 'a1000000-0000-4000-8000-000000000001'
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'id', id,
    'tenant_id', tenant_id,
    'original_sale_id', original_sale_id,
    'user_id', user_id,
    'reason', 'Cambio',
    'created_at', now(),
    'client_created_at', now()
  );
$$;

SELECT tests.authenticate(:'user_a');

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------

\set sale_1 a3000000-0000-4000-8000-000000000001
\set line_1 a4000000-0000-4000-8000-000000000001

SELECT tests.is(
  public.powersync_create_sale(
    tests.sale_row(:'sale_1'),
    tests.line_rows(:'sale_1', :'line_1')
  ),
  :'sale_1'::uuid,
  'a member records a sale and its lines in one call'
);
SELECT tests.is(
  public.powersync_create_sale(
    tests.sale_row(:'sale_1'),
    tests.line_rows(:'sale_1', :'line_1')
  ),
  :'sale_1'::uuid,
  'retrying the same upload returns the recorded sale'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.sale_lines WHERE sale_id = :'sale_1'),
  1,
  'the retry adds no second line'
);
SELECT tests.throws(
  tests.create_sale_call(
    tests.sale_row(:'sale_1', sale_discount_cents => '100'),
    tests.line_rows(:'sale_1', :'line_1')
  ),
  '23505',
  'a sale id that belongs to different data is refused'
);
SELECT tests.throws(
  tests.create_sale_call(
    tests.sale_row('a3000000-0000-4000-8000-000000000002'),
    tests.line_rows('a3000000-0000-4000-8000-000000000002', :'line_1')
  ),
  '23505',
  'a line id that belongs to another sale is refused'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.sales WHERE id = 'a3000000-0000-4000-8000-000000000002'),
  0,
  'a refused upload leaves no sale header behind'
);
SELECT tests.throws(
  tests.create_sale_call(
    tests.sale_row(:'sale_1', tenant_id => :'tenant_b'),
    tests.line_rows(:'sale_1')
  ),
  '42501',
  'a member cannot record a sale in another tenant'
);
SELECT tests.throws(
  tests.create_sale_call(
    tests.sale_row(gen_random_uuid(), user_id => :'user_b'),
    tests.line_rows(gen_random_uuid())
  ),
  '42501',
  'a member cannot record a sale in another user''s name'
);

\set sale_2 a3000000-0000-4000-8000-000000000003

SELECT tests.throws(
  tests.create_sale_call(
    tests.sale_row(:'sale_2'),
    tests.line_rows(:'sale_2', product_id => :'product_b')
  ),
  '23503',
  'a line cannot sell another tenant''s product'
);
SELECT tests.throws(
  tests.create_sale_call(
    tests.sale_row(:'sale_2', sale_discount_cents => '3001'),
    tests.line_rows(:'sale_2')
  ),
  '22023',
  'the sale discount cannot exceed the lines'' total'
);
SELECT tests.throws(
  tests.create_sale_call(
    tests.sale_row(:'sale_2'),
    tests.line_rows(:'sale_2', quantity => '1.5', line_total_cents => '2250')
  ),
  '22023',
  'a fractional quantity is refused'
);
SELECT tests.throws(
  tests.create_sale_call(
    tests.sale_row(:'sale_2'),
    tests.line_rows(:'sale_2', line_total_cents => '2999')
  ),
  '22023',
  'a line total that does not match price times quantity is refused'
);
SELECT tests.throws(
  tests.create_sale_call(
    tests.sale_row(:'sale_2'),
    tests.line_rows(:'sale_2', quantity => '3000000000')
  ),
  '22023',
  'a quantity beyond int4 is refused with a data error'
);
SELECT tests.throws(
  tests.create_sale_call(
    tests.sale_row(:'sale_2', created_at => now() + interval '1 hour'),
    tests.line_rows(:'sale_2', created_at => now() + interval '1 hour')
  ),
  '55000',
  'a device clock an hour ahead is retried later, not refused'
);

\set old_sale a3000000-0000-4000-8000-000000000004

SELECT tests.is(
  public.powersync_create_sale(
    tests.sale_row(:'old_sale', created_at => now() - interval '3 days'),
    tests.line_rows(:'old_sale', created_at => now() - interval '3 days')
  ),
  :'old_sale'::uuid,
  'a sale recorded offline days ago is accepted'
);

SELECT tests.as_owner();
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT tests.throws(
  tests.create_sale_call(tests.sale_row(:'sale_2'), tests.line_rows(:'sale_2')),
  '42501',
  'a token without a user is refused'
);
SELECT tests.authenticate(:'user_a');

-- ---------------------------------------------------------------------------
-- Voids
-- ---------------------------------------------------------------------------

SELECT tests.is(
  public.powersync_void_sale(:'sale_1', :'user_a', now()),
  :'sale_1'::uuid,
  'a member voids their tenant''s sale within 10 minutes'
);
SELECT tests.ok(
  (SELECT voided_at IS NOT NULL AND voided_by_user_id = :'user_a'
    FROM public.sales WHERE id = :'sale_1'),
  'the void is recorded with its author'
);
SELECT tests.is(
  public.powersync_void_sale(:'sale_1', :'user_a', now()),
  :'sale_1'::uuid,
  'retrying a void returns the voided sale'
);
SELECT tests.throws(
  format('SELECT public.powersync_void_sale(%L, %L, now())', :'sale_b', :'user_a'),
  '42501',
  'a member cannot void another tenant''s sale'
);
SELECT tests.throws(
  format('SELECT public.powersync_void_sale(%L, %L, now())', :'sale_1', :'user_b'),
  '42501',
  'a void cannot be attributed to another user'
);
SELECT tests.throws(
  format('SELECT public.powersync_void_sale(%L, %L, now())', :'old_sale', :'user_a'),
  '23514',
  'a sale older than 10 minutes cannot be voided'
);

\set legacy_sale a3000000-0000-4000-8000-000000000005

SELECT public.powersync_create_sale(
  tests.sale_row(:'legacy_sale'),
  tests.line_rows(:'legacy_sale')
);
SELECT tests.is(
  public.powersync_void_sale(:'legacy_sale', :'user_a'),
  :'legacy_sale'::uuid,
  'the legacy void without a device timestamp still works'
);

-- ---------------------------------------------------------------------------
-- Refunds, and refunds racing voids
-- ---------------------------------------------------------------------------

\set refunded_sale a3000000-0000-4000-8000-000000000006
\set refund_1 a5000000-0000-4000-8000-000000000001

SELECT public.powersync_create_sale(
  tests.sale_row(:'refunded_sale'),
  tests.line_rows(:'refunded_sale')
);
SELECT tests.is(
  public.powersync_create_refund(tests.refund_row(:'refund_1', :'refunded_sale')),
  :'refund_1'::uuid,
  'a member refunds a sale'
);
SELECT tests.is(
  public.powersync_create_refund(tests.refund_row(:'refund_1', :'refunded_sale')),
  :'refund_1'::uuid,
  'retrying a refund returns the recorded refund'
);
SELECT tests.is(
  public.powersync_create_refund(
    tests.refund_row('a5000000-0000-4000-8000-000000000002', :'refunded_sale')
  ),
  :'refund_1'::uuid,
  'a second device''s refund of the same sale converges on the first'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.refunds WHERE original_sale_id = :'refunded_sale'),
  1,
  'a sale is refunded once'
);
SELECT tests.is(
  public.powersync_void_sale(:'refunded_sale', :'user_a', now()),
  NULL::uuid,
  'a void that arrives after a refund is not applied'
);
SELECT tests.ok(
  (SELECT voided_at IS NULL FROM public.sales WHERE id = :'refunded_sale'),
  'the refunded sale stays unvoided'
);
SELECT tests.is(
  public.powersync_create_refund(
    tests.refund_row('a5000000-0000-4000-8000-000000000003', :'sale_1')
  ),
  NULL::uuid,
  'a refund that arrives after a void is not applied'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.refunds WHERE original_sale_id = :'sale_1'),
  0,
  'the voided sale keeps no refund'
);
SELECT tests.throws(
  format(
    'SELECT public.powersync_create_refund(%L)',
    tests.refund_row(gen_random_uuid(), :'old_sale', user_id => :'user_b')
  ),
  '42501',
  'a refund cannot be attributed to another user'
);
SELECT tests.throws(
  format(
    'SELECT public.powersync_create_refund(%L)',
    tests.refund_row(gen_random_uuid(), :'sale_b', tenant_id => :'tenant_b')
  ),
  '42501',
  'a member cannot refund another tenant''s sale'
);
SELECT tests.throws(
  format(
    'SELECT public.powersync_create_refund(%L)',
    tests.refund_row(gen_random_uuid(), :'sale_b')
  ),
  '23503',
  'a refund must name a sale of its own tenant'
);
SELECT tests.throws(
  format(
    'SELECT public.powersync_create_refund(%L)',
    tests.refund_row(:'refund_1', :'old_sale')
  ),
  '23505',
  'a refund id that belongs to another sale is refused'
);

ROLLBACK;
