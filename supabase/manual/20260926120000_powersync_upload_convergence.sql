-- Apply after `pnpm db:push`, after
-- 20260808235900_powersync_atomic_financial_mutations.sql and after deploying
-- the app build whose uploader handles the NULL results below (older builds
-- keep retrying a refund that lost), in the Supabase SQL editor. Every
-- statement is idempotent, so the file can be re-run.
--
-- PowerSync devices upload their queue in order, and a transaction that fails
-- with a data or constraint error (Class 22/23) stays at the head of the queue
-- and blocks every later upload from that device. This file keeps legitimate
-- offline work from ending up there:
--
-- 1. Cross-device conflicts converge. A void that reaches the server after
--    another device refunded the sale, or a refund that arrives after a void,
--    is not applied and returns NULL instead of raising. The uploader then
--    drops its local row, so the device matches the server.
-- 2. Device time stays the business time. Offline uploads can arrive days
--    late, so old timestamps are accepted (the 24-hour void upload window is
--    gone). A timestamp more than 5 minutes ahead of the server clock raises
--    55000, which the uploader retries instead of recording a permanent
--    failure: the upload goes through once the server clock catches up.
-- 3. Upload payload numbers must be whole int4 values. NULL, fractional or
--    out-of-range money and quantities fail with a deterministic 22023 error.
-- 4. Postgres itself rejects refunding a voided sale, for every writer, and
--    serializes refunds with voids on the sale row.
-- 5. anon can no longer execute the PowerSync SECURITY DEFINER functions.
--
-- Rules mirrored in TypeScript (keep them in step):
--   void window 10 minutes, cross-device clock skew 5 seconds
--     -> VOID_WINDOW_MS / VOID_CLOCK_SKEW_TOLERANCE_MS in lib/sales.ts
--   NULL result = conflict lost, drop the local row -> lib/powersync/connector.ts
--   55000 is retryable, Class 22/23 are permanent  -> lib/powersync/connector.ts

-- ---------------------------------------------------------------------------
-- Upload value helpers
-- ---------------------------------------------------------------------------

-- Reads a whole number from an upload payload. Accepts JSON numbers and
-- integer strings; JSON null and blank strings are NULL (callers decide whether
-- the field is required). Anything else raises 22023 instead of the less
-- specific cast errors (22P02, 22003).
CREATE OR REPLACE FUNCTION public.upload_integer(value jsonb, field_name text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  value_type text := jsonb_typeof(value);
  text_value text := btrim(value #>> '{}');
  numeric_value numeric;
BEGIN
  IF value_type IS NULL
     OR value_type = 'null'
     OR (value_type = 'string' AND text_value = '') THEN
    RETURN NULL;
  END IF;

  IF value_type = 'number'
     OR (value_type = 'string' AND text_value ~ '^[+-]?[0-9]+$') THEN
    numeric_value := text_value::numeric;
  END IF;

  IF numeric_value IS NULL
     OR numeric_value <> trunc(numeric_value)
     OR numeric_value NOT BETWEEN -2147483648 AND 2147483647 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format(
        'The %s field must be a whole number between -2147483648 and 2147483647.',
        field_name
      );
  END IF;

  RETURN numeric_value::integer;
END;
$$;

-- Reads a finite timestamp from an upload payload. JSON null and blank strings
-- are NULL; anything unparseable or infinite raises 22023.
CREATE OR REPLACE FUNCTION public.upload_timestamptz(value jsonb, field_name text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  value_type text := jsonb_typeof(value);
  text_value text := btrim(value #>> '{}');
  parsed timestamptz;
BEGIN
  IF value_type IS NULL
     OR value_type = 'null'
     OR (value_type = 'string' AND text_value = '') THEN
    RETURN NULL;
  END IF;

  IF value_type = 'string' THEN
    BEGIN
      parsed := text_value::timestamptz;
    EXCEPTION WHEN data_exception THEN
      parsed := NULL;
    END;
  END IF;

  IF parsed IS NULL OR NOT isfinite(parsed) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('The %s field must be a valid timestamp.', field_name);
  END IF;

  RETURN parsed;
END;
$$;

-- The server-side bound on device timestamps. Old values are fine: a device
-- can stay offline for days. A value far ahead of the server clock means the
-- device clock is wrong; 55000 is neither a data nor a constraint error, so the
-- uploader keeps the transaction queued and retries it without recording a
-- permanent failure. Because the stored value is fixed and the server clock
-- advances, the retry succeeds once the skew drops under 5 minutes.
CREATE OR REPLACE FUNCTION public.check_upload_timestamp(
  value timestamptz,
  field_name text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
  IF value IS NULL THEN
    RETURN;
  END IF;

  IF NOT isfinite(value) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('The %s field must be a valid timestamp.', field_name);
  END IF;

  IF value > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'The %s timestamp is more than 5 minutes ahead of the server clock.',
        field_name
      ),
      HINT = 'Check the device date and time. The upload is retried automatically.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Financial RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.powersync_create_sale(
  sale_row jsonb,
  sale_line_rows jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  authenticated_user_id uuid := auth.uid();
  sale_id_value uuid;
  tenant_id_value uuid;
  sale_user_id_value uuid;
  payment_method_value public.payment_method;
  sale_discount_value integer;
  sale_created_at_value timestamptz;
  sale_client_created_at_value timestamptz;
  line_row jsonb;
  line_id_value uuid;
  line_sale_id_value uuid;
  line_tenant_id_value uuid;
  line_product_id_value uuid;
  line_quantity_value integer;
  line_unit_price_value integer;
  line_unit_cost_value integer;
  line_discount_value integer;
  line_total_value integer;
  line_created_at_value timestamptz;
  line_total_sum bigint := 0;
  existing_sale public.sales%ROWTYPE;
  existing_line public.sale_lines%ROWTYPE;
BEGIN
  IF authenticated_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication is required.';
  END IF;

  IF jsonb_typeof(sale_row) IS DISTINCT FROM 'object'
     OR jsonb_typeof(sale_line_rows) IS DISTINCT FROM 'array'
     OR jsonb_array_length(sale_line_rows) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A sale and at least one sale line are required.';
  END IF;

  sale_id_value := (sale_row ->> 'id')::uuid;
  tenant_id_value := (sale_row ->> 'tenant_id')::uuid;
  sale_user_id_value := (sale_row ->> 'user_id')::uuid;
  payment_method_value := (sale_row ->> 'payment_method')::public.payment_method;
  sale_discount_value := public.upload_integer(
    sale_row -> 'sale_discount_cents',
    'sale_discount_cents'
  );
  sale_created_at_value := public.upload_timestamptz(
    sale_row -> 'created_at',
    'created_at'
  );
  sale_client_created_at_value := public.upload_timestamptz(
    sale_row -> 'client_created_at',
    'client_created_at'
  );

  IF sale_id_value IS NULL OR tenant_id_value IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The sale id and tenant_id fields are required.';
  END IF;

  IF sale_user_id_value IS DISTINCT FROM authenticated_user_id
     OR NOT public.current_user_has_tenant(tenant_id_value) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'The authenticated user cannot create this sale.';
  END IF;

  IF sale_discount_value IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The sale_discount_cents field is required.';
  END IF;

  IF sale_created_at_value IS NULL OR sale_client_created_at_value IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The created_at and client_created_at fields are required.';
  END IF;

  IF sale_discount_value < 0
     OR sale_row ->> 'voided_at' IS NOT NULL
     OR sale_row ->> 'voided_by_user_id' IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The sale header is invalid.';
  END IF;

  IF (
    SELECT count(*) <> count(DISTINCT value ->> 'id')
    FROM jsonb_array_elements(sale_line_rows)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Sale line identifiers must be unique.';
  END IF;

  -- Validate every line and compute the maximum legal sale-level discount
  -- before inserting anything. Any exception rolls the whole RPC back. The
  -- line rules match the sale_lines CHECK constraints in lib/db/schema.ts.
  FOR line_row IN SELECT value FROM jsonb_array_elements(sale_line_rows)
  LOOP
    IF jsonb_typeof(line_row) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'One or more sale lines are invalid.';
    END IF;

    line_id_value := (line_row ->> 'id')::uuid;
    line_sale_id_value := (line_row ->> 'sale_id')::uuid;
    line_tenant_id_value := (line_row ->> 'tenant_id')::uuid;
    line_product_id_value := (line_row ->> 'product_id')::uuid;
    line_quantity_value := public.upload_integer(line_row -> 'quantity', 'quantity');
    line_unit_price_value := public.upload_integer(
      line_row -> 'unit_price_cents',
      'unit_price_cents'
    );
    line_unit_cost_value := public.upload_integer(
      line_row -> 'unit_cost_cents',
      'unit_cost_cents'
    );
    line_discount_value := public.upload_integer(
      line_row -> 'line_discount_cents',
      'line_discount_cents'
    );
    line_total_value := public.upload_integer(
      line_row -> 'line_total_cents',
      'line_total_cents'
    );
    line_created_at_value := public.upload_timestamptz(
      line_row -> 'created_at',
      'created_at'
    );

    IF line_id_value IS NULL
       OR line_sale_id_value IS DISTINCT FROM sale_id_value
       OR line_tenant_id_value IS DISTINCT FROM tenant_id_value
       OR line_quantity_value IS NULL
       OR line_unit_price_value IS NULL
       OR line_discount_value IS NULL
       OR line_total_value IS NULL
       OR line_quantity_value <= 0
       OR line_unit_price_value < 0
       OR (line_unit_cost_value IS NOT NULL AND line_unit_cost_value < 0)
       OR line_discount_value < 0
       OR line_discount_value > line_unit_price_value::bigint * line_quantity_value
       OR line_total_value::bigint IS DISTINCT FROM
          line_unit_price_value::bigint * line_quantity_value - line_discount_value
       OR line_created_at_value IS NULL
       OR NULLIF(btrim(line_row ->> 'product_name'), '') IS NULL
       OR NULLIF(btrim(line_row ->> 'category'), '') IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'One or more sale lines are invalid.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.products
      WHERE products.id = line_product_id_value
        AND products.tenant_id = tenant_id_value
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23503',
        MESSAGE = 'A sale line product does not belong to the sale tenant.';
    END IF;

    PERFORM public.check_upload_timestamp(line_created_at_value, 'created_at');

    line_total_sum := line_total_sum + line_total_value;
  END LOOP;

  IF sale_discount_value > line_total_sum THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The sale discount exceeds the sale line total.';
  END IF;

  PERFORM public.check_upload_timestamp(sale_created_at_value, 'created_at');
  PERFORM public.check_upload_timestamp(
    sale_client_created_at_value,
    'client_created_at'
  );

  -- Retry-safe and able to repair a partial sale left by the legacy uploader.
  -- Serialize the header and line check/insert paths for retries of this sale.
  PERFORM pg_advisory_xact_lock(hashtextextended(sale_id_value::text, 0));

  SELECT * INTO existing_sale
  FROM public.sales
  WHERE sales.id = sale_id_value
  FOR UPDATE;

  IF FOUND THEN
    IF existing_sale.tenant_id IS DISTINCT FROM tenant_id_value
       OR existing_sale.user_id IS DISTINCT FROM sale_user_id_value
       OR existing_sale.payment_method IS DISTINCT FROM payment_method_value
       OR existing_sale.sale_discount_cents IS DISTINCT FROM sale_discount_value
       OR existing_sale.client_created_at IS DISTINCT FROM sale_client_created_at_value THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'The sale identifier already belongs to different data.';
    END IF;
  ELSE
    INSERT INTO public.sales (
      id,
      tenant_id,
      user_id,
      payment_method,
      sale_discount_cents,
      sale_discount_reason,
      voided_at,
      voided_by_user_id,
      created_at,
      client_created_at
    ) VALUES (
      sale_id_value,
      tenant_id_value,
      sale_user_id_value,
      payment_method_value,
      sale_discount_value,
      NULLIF(btrim(sale_row ->> 'sale_discount_reason'), ''),
      NULL,
      NULL,
      sale_created_at_value,
      sale_client_created_at_value
    );
  END IF;

  FOR line_row IN SELECT value FROM jsonb_array_elements(sale_line_rows)
  LOOP
    line_id_value := (line_row ->> 'id')::uuid;
    line_product_id_value := (line_row ->> 'product_id')::uuid;
    line_quantity_value := public.upload_integer(line_row -> 'quantity', 'quantity');
    line_unit_price_value := public.upload_integer(
      line_row -> 'unit_price_cents',
      'unit_price_cents'
    );
    line_unit_cost_value := public.upload_integer(
      line_row -> 'unit_cost_cents',
      'unit_cost_cents'
    );
    line_discount_value := public.upload_integer(
      line_row -> 'line_discount_cents',
      'line_discount_cents'
    );
    line_total_value := public.upload_integer(
      line_row -> 'line_total_cents',
      'line_total_cents'
    );
    line_created_at_value := public.upload_timestamptz(
      line_row -> 'created_at',
      'created_at'
    );

    SELECT * INTO existing_line
    FROM public.sale_lines
    WHERE sale_lines.id = line_id_value;

    IF FOUND THEN
      IF existing_line.sale_id IS DISTINCT FROM sale_id_value
         OR existing_line.tenant_id IS DISTINCT FROM tenant_id_value
         OR existing_line.product_id IS DISTINCT FROM line_product_id_value
         OR existing_line.quantity IS DISTINCT FROM line_quantity_value
         OR existing_line.unit_price_cents IS DISTINCT FROM line_unit_price_value
         OR existing_line.unit_cost_cents IS DISTINCT FROM line_unit_cost_value
         OR existing_line.line_discount_cents IS DISTINCT FROM line_discount_value
         OR existing_line.line_total_cents IS DISTINCT FROM line_total_value THEN
        RAISE EXCEPTION USING
          ERRCODE = '23505',
          MESSAGE = 'A sale line identifier already belongs to different data.';
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.sale_lines (
      id,
      sale_id,
      tenant_id,
      product_id,
      product_name,
      category,
      quantity,
      unit_price_cents,
      unit_cost_cents,
      line_discount_cents,
      line_discount_reason,
      line_total_cents,
      created_at
    ) VALUES (
      line_id_value,
      sale_id_value,
      tenant_id_value,
      line_product_id_value,
      line_row ->> 'product_name',
      line_row ->> 'category',
      line_quantity_value,
      line_unit_price_value,
      line_unit_cost_value,
      line_discount_value,
      NULLIF(btrim(line_row ->> 'line_discount_reason'), ''),
      line_total_value,
      line_created_at_value
    );
  END LOOP;

  RETURN sale_id_value;
END;
$$;

-- Returns the sale id when the sale is voided (now or by an earlier upload),
-- or NULL when a refund reached the server first. A refunded sale is never
-- voided, so the refund wins and the uploader drops its local void.
CREATE OR REPLACE FUNCTION public.powersync_void_sale(
  sale_id uuid,
  voided_by_user_id uuid,
  voided_at_value timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  authenticated_user_id uuid := auth.uid();
  sale_record public.sales%ROWTYPE;
BEGIN
  IF voided_at_value IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A void timestamp is required.';
  END IF;

  IF authenticated_user_id IS NULL
     OR voided_by_user_id IS DISTINCT FROM authenticated_user_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'The authenticated user cannot void this sale.';
  END IF;

  -- The row lock serializes this void with refunds, which lock the same row.
  SELECT * INTO sale_record
  FROM public.sales
  WHERE sales.id = sale_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.current_user_has_tenant(sale_record.tenant_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'The sale was not found in an accessible tenant.';
  END IF;

  -- Idempotent retry, or another device voided the sale first: the business
  -- action is already complete.
  IF sale_record.voided_at IS NOT NULL THEN
    RETURN sale_record.id;
  END IF;

  -- Checked before the void window so that the conflict converges whatever
  -- the timestamps are.
  IF EXISTS (
    SELECT 1 FROM public.refunds
    WHERE refunds.original_sale_id = sale_record.id
  ) THEN
    RETURN NULL;
  END IF;

  -- Both timestamps are device time. The device that voids checks the same
  -- window before it writes, so only a crafted call or the legacy overload
  -- fails here. The 5-second allowance covers a voiding device whose clock is
  -- slightly behind the device that recorded the sale.
  IF voided_at_value < sale_record.created_at - interval '5 seconds'
     OR voided_at_value > sale_record.created_at + interval '10 minutes' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Sales can only be voided within 10 minutes.';
  END IF;

  PERFORM public.check_upload_timestamp(voided_at_value, 'voided_at');

  UPDATE public.sales
  SET voided_at = voided_at_value,
      voided_by_user_id = authenticated_user_id
  WHERE sales.id = sale_record.id;

  RETURN sale_record.id;
END;
$$;

-- Legacy overload for PWAs installed before 2026-08-09, whose queued voids
-- carry no device timestamp. The void time falls back to the server clock, so
-- a void uploaded more than 10 minutes after its sale still fails.
-- Sunset: drop this overload in a new supabase/manual file after 2026-12-31,
-- once no installed PWA older than the 3-argument uploader can still hold a
-- queued void (check the API logs for calls without voided_at_value first).
CREATE OR REPLACE FUNCTION public.powersync_void_sale(
  sale_id uuid,
  voided_by_user_id uuid
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.powersync_void_sale(
    sale_id,
    voided_by_user_id,
    clock_timestamp()
  );
$$;

COMMENT ON FUNCTION public.powersync_void_sale(uuid, uuid) IS
  'Deprecated legacy PowerSync void without a device timestamp. Drop after 2026-12-31.';

-- Returns the canonical refund id, or NULL when the sale was voided before
-- this refund reached the server. A voided sale is never refunded, so the
-- uploader drops its local refund.
CREATE OR REPLACE FUNCTION public.powersync_create_refund(refund_row jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  authenticated_user_id uuid := auth.uid();
  refund_id_value uuid;
  tenant_id_value uuid;
  original_sale_id_value uuid;
  refund_user_id_value uuid;
  refund_created_at_value timestamptz;
  refund_client_created_at_value timestamptz;
  sale_record public.sales%ROWTYPE;
  existing_refund public.refunds%ROWTYPE;
BEGIN
  IF authenticated_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication is required.';
  END IF;

  IF jsonb_typeof(refund_row) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A refund row is required.';
  END IF;

  refund_id_value := (refund_row ->> 'id')::uuid;
  tenant_id_value := (refund_row ->> 'tenant_id')::uuid;
  original_sale_id_value := (refund_row ->> 'original_sale_id')::uuid;
  refund_user_id_value := (refund_row ->> 'user_id')::uuid;
  refund_created_at_value := public.upload_timestamptz(
    refund_row -> 'created_at',
    'created_at'
  );
  refund_client_created_at_value := public.upload_timestamptz(
    refund_row -> 'client_created_at',
    'client_created_at'
  );

  IF refund_id_value IS NULL
     OR tenant_id_value IS NULL
     OR refund_created_at_value IS NULL
     OR refund_client_created_at_value IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The refund id, tenant_id, created_at, and client_created_at fields are required.';
  END IF;

  IF refund_user_id_value IS DISTINCT FROM authenticated_user_id
     OR NOT public.current_user_has_tenant(tenant_id_value) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'The authenticated user cannot create this refund.';
  END IF;

  SELECT * INTO sale_record
  FROM public.sales
  WHERE sales.id = original_sale_id_value
    AND sales.tenant_id = tenant_id_value
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'The original sale was not found in the refund tenant.';
  END IF;

  -- Another device (or the server action) voided the sale first. Checked
  -- before the insert so the refunds trigger below never fires for uploads.
  IF sale_record.voided_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO existing_refund
  FROM public.refunds
  WHERE refunds.id = refund_id_value;

  IF FOUND THEN
    IF existing_refund.tenant_id IS DISTINCT FROM tenant_id_value
       OR existing_refund.original_sale_id IS DISTINCT FROM original_sale_id_value
       OR existing_refund.user_id IS DISTINCT FROM refund_user_id_value THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'The refund identifier already belongs to different data.';
    END IF;
    RETURN existing_refund.id;
  END IF;

  -- Two devices may refund the same sale concurrently. The sale-row lock makes
  -- this check deterministic; the later operation converges to the canonical
  -- refund instead of becoming a permanent sync failure.
  SELECT * INTO existing_refund
  FROM public.refunds
  WHERE refunds.original_sale_id = original_sale_id_value;

  IF FOUND THEN
    RETURN existing_refund.id;
  END IF;

  PERFORM public.check_upload_timestamp(refund_created_at_value, 'created_at');
  PERFORM public.check_upload_timestamp(
    refund_client_created_at_value,
    'client_created_at'
  );

  INSERT INTO public.refunds (
    id,
    tenant_id,
    original_sale_id,
    user_id,
    reason,
    created_at,
    client_created_at
  ) VALUES (
    refund_id_value,
    tenant_id_value,
    original_sale_id_value,
    refund_user_id_value,
    NULLIF(btrim(refund_row ->> 'reason'), ''),
    refund_created_at_value,
    refund_client_created_at_value
  );

  RETURN refund_id_value;
END;
$$;

-- ---------------------------------------------------------------------------
-- Triggers (every writer, including server actions)
-- ---------------------------------------------------------------------------

-- Replaces the 20260808235900 version: same immutability and first-void
-- rules, the 5-second skew allowance of the void RPC, and no 24-hour lower
-- bound on the void time.
CREATE OR REPLACE FUNCTION public.sales_enforce_void_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.sale_discount_cents IS DISTINCT FROM OLD.sale_discount_cents
     OR NEW.sale_discount_reason IS DISTINCT FROM OLD.sale_discount_reason
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.client_created_at IS DISTINCT FROM OLD.client_created_at
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Committed sale fields are immutable.';
  END IF;

  IF OLD.voided_at IS NOT NULL
     OR NEW.voided_at IS NULL
     OR NEW.voided_by_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'A sale update must be a first-time void.';
  END IF;

  IF NEW.voided_at < OLD.created_at - interval '5 seconds'
     OR NEW.voided_at > OLD.created_at + interval '10 minutes' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Sales can only be voided within 10 minutes.';
  END IF;

  PERFORM public.check_upload_timestamp(NEW.voided_at, 'voided_at');

  -- The UPDATE holds the sale row lock here, and refunds take the same lock
  -- before inserting, so this check cannot miss a concurrent refund.
  IF EXISTS (
    SELECT 1 FROM public.refunds
    WHERE refunds.original_sale_id = OLD.id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'A refunded sale cannot be voided.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_void_transition ON public.sales;
CREATE TRIGGER sales_void_transition
  BEFORE UPDATE ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.sales_enforce_void_transition();

-- A voided sale cannot be refunded, whoever writes the refund. Locking the
-- sale row makes a concurrent void wait for this insert (and then fail on the
-- refund), or this insert wait for the void (and then fail here).
CREATE OR REPLACE FUNCTION public.refunds_reject_voided_sale()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  sale_voided_at timestamptz;
BEGIN
  SELECT sales.voided_at INTO sale_voided_at
  FROM public.sales
  WHERE sales.id = NEW.original_sale_id
    AND sales.tenant_id = NEW.tenant_id
  FOR UPDATE;

  -- A missing sale is left to the composite foreign key (23503).
  IF sale_voided_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'A voided sale cannot be refunded.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refunds_reject_voided_sale ON public.refunds;
CREATE TRIGGER refunds_reject_voided_sale
  BEFORE INSERT OR UPDATE OF original_sale_id, tenant_id ON public.refunds
  FOR EACH ROW
  EXECUTE FUNCTION public.refunds_reject_voided_sale();

-- Products and inventory movements upload through PostgREST, not an RPC. The
-- trigger arguments name the device-stamped timestamp columns to bound.
CREATE OR REPLACE FUNCTION public.check_upload_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  new_row jsonb := to_jsonb(NEW);
  timestamp_column text;
BEGIN
  FOREACH timestamp_column IN ARRAY TG_ARGV
  LOOP
    PERFORM public.check_upload_timestamp(
      (new_row ->> timestamp_column)::timestamptz,
      timestamp_column
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_check_upload_timestamps ON public.products;
CREATE TRIGGER products_check_upload_timestamps
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.check_upload_timestamps(
    'created_at',
    'updated_at',
    'archived_at'
  );

DROP TRIGGER IF EXISTS inventory_movements_check_upload_timestamps
  ON public.inventory_movements;
CREATE TRIGGER inventory_movements_check_upload_timestamps
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.check_upload_timestamps(
    'created_at',
    'client_created_at'
  );

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Supabase grants EXECUTE on new public functions to anon and authenticated
-- explicitly, so revoking from PUBLIC alone left anon able to call these.
REVOKE ALL ON FUNCTION public.powersync_create_sale(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.powersync_void_sale(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.powersync_void_sale(uuid, uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.powersync_create_refund(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.powersync_create_sale(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.powersync_void_sale(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.powersync_void_sale(uuid, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.powersync_create_refund(jsonb) TO authenticated;

-- Parsers used only inside the SECURITY DEFINER RPCs, which run as the owner.
REVOKE ALL ON FUNCTION public.upload_integer(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upload_timestamptz(jsonb, text) FROM PUBLIC, anon, authenticated;

-- check_upload_timestamps runs as the uploading user when a product or
-- inventory movement is inserted, so authenticated keeps EXECUTE on the check
-- it calls. The check reads no data.
REVOKE ALL ON FUNCTION public.check_upload_timestamp(timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_upload_timestamp(timestamptz, text) TO authenticated;

-- Trigger functions are never called directly.
REVOKE ALL ON FUNCTION public.sales_enforce_void_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refunds_reject_voided_sale() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_upload_timestamps() FROM PUBLIC, anon, authenticated;
