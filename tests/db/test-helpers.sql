-- Assertion helpers for the tests/db/*.test.sql files, installed by
-- `pnpm test:db` after the migrations, the hand-written SQL and the seed.
--
-- Each test file runs in one transaction that it rolls back, so files never
-- see each other's rows. A failed assertion raises, which stops the file and
-- fails the run; a passing one prints "ok - <description>".

CREATE SCHEMA tests;
GRANT USAGE ON SCHEMA tests TO PUBLIC;

-- Acts, until the end of the transaction, as PostgREST does for a request with
-- this user's JWT. Pass NULL for a request with only the publishable key.
CREATE FUNCTION tests.authenticate(user_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config(
    'request.jwt.claims',
    CASE
      WHEN user_id IS NULL THEN '{"role":"anon"}'
      ELSE json_build_object('sub', user_id, 'role', 'authenticated')::text
    END,
    true
  );
  SELECT set_config(
    'role',
    CASE WHEN user_id IS NULL THEN 'anon' ELSE 'authenticated' END,
    true
  );
$$;

-- Back to the superuser that owns the tables (RLS does not apply to it), to
-- arrange data or read what a statement really changed.
CREATE FUNCTION tests.as_owner()
RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('request.jwt.claims', '', true);
  SELECT set_config('role', 'none', true);
$$;

-- An auth user, for foreign keys and memberships.
CREATE FUNCTION tests.create_user(user_id uuid, email text)
RETURNS uuid
LANGUAGE sql
AS $$
  INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
  VALUES (user_id, 'authenticated', 'authenticated', email, '{}', '{}')
  RETURNING id;
$$;

-- A tenant with its owner as the only member, as the first sign-in creates it.
CREATE FUNCTION tests.create_tenant(tenant_id uuid, owner_id uuid)
RETURNS uuid
LANGUAGE sql
AS $$
  INSERT INTO public.tenants (id, name, created_by_user_id)
  VALUES (tenant_id, 'Puesto ' || left(tenant_id::text, 8), owner_id);
  INSERT INTO public.tenant_users (tenant_id, user_id, display_name)
  VALUES (tenant_id, owner_id, 'Miembro')
  RETURNING tenant_id;
$$;

CREATE FUNCTION tests.create_product(
  product_id uuid,
  tenant_id uuid,
  price_cents integer DEFAULT 1500
)
RETURNS uuid
LANGUAGE sql
AS $$
  INSERT INTO public.products (id, tenant_id, name, price_cents, category)
  VALUES (product_id, tenant_id, 'Sticker', price_cents, 'Stickers')
  RETURNING id;
$$;

-- A cash sale of one unit of the product, written directly as the server
-- actions do (the owner bypasses RLS; the triggers still run).
CREATE FUNCTION tests.create_sale(
  sale_id uuid,
  tenant_id uuid,
  user_id uuid,
  product_id uuid,
  created_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE sql
AS $$
  INSERT INTO public.sales (id, tenant_id, user_id, payment_method, created_at, client_created_at)
  VALUES (sale_id, tenant_id, user_id, 'cash', created_at, created_at);
  INSERT INTO public.sale_lines (
    sale_id, tenant_id, product_id, product_name, category, quantity,
    unit_price_cents, line_total_cents, created_at
  )
  SELECT create_sale.sale_id, create_sale.tenant_id, products.id, products.name,
    products.category, 1, products.price_cents, products.price_cents,
    create_sale.created_at
  FROM public.products
  WHERE products.id = create_sale.product_id;
  SELECT create_sale.sale_id;
$$;

-- Runs a statement as the current role and returns how many rows it changed.
-- RLS filters UPDATE and DELETE rows silently, so a refused change shows as 0.
CREATE FUNCTION tests.affected_rows(statement text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
BEGIN
  EXECUTE statement;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE FUNCTION tests.ok(condition boolean, description text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF condition IS NOT TRUE THEN
    RAISE EXCEPTION 'not ok - %', description;
  END IF;
  RAISE NOTICE 'ok - %', description;
END;
$$;

CREATE FUNCTION tests.is(actual anycompatible, expected anycompatible, description text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'not ok - % (got %, expected %)',
      description, coalesce(actual::text, 'NULL'), coalesce(expected::text, 'NULL');
  END IF;
  RAISE NOTICE 'ok - %', description;
END;
$$;

-- Runs a statement as the current role and expects it to fail with the given
-- SQLSTATE. The statement's changes are rolled back either way.
CREATE FUNCTION tests.throws(
  statement text,
  expected_state text,
  description text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  actual_state text;
  actual_message text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      actual_state = RETURNED_SQLSTATE,
      actual_message = MESSAGE_TEXT;
    IF actual_state = expected_state THEN
      RAISE NOTICE 'ok - %', description;
      RETURN;
    END IF;
    RAISE EXCEPTION 'not ok - % (expected %, got %: %)',
      description, expected_state, actual_state, actual_message;
  END;
  RAISE EXCEPTION 'not ok - % (expected %, no error)', description, expected_state;
END;
$$;
