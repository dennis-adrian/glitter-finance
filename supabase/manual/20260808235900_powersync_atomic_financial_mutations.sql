-- Apply after all Drizzle migrations and the existing RLS manual SQL.
--
-- PowerSync records a local SQLite transaction as one CRUD transaction, but
-- sending each CRUD entry through PostgREST separately is not atomic in
-- Postgres. These authenticated RPCs preserve the local transaction boundary
-- for financial writes and keep direct clients from bypassing the invariants.

CREATE OR REPLACE FUNCTION public.powersync_create_sale(
  sale_row jsonb,
  sale_line_rows jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
  sale_discount_value := (sale_row ->> 'sale_discount_cents')::integer;
  sale_created_at_value := (sale_row ->> 'created_at')::timestamptz;
  sale_client_created_at_value := (sale_row ->> 'client_created_at')::timestamptz;

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

  IF sale_created_at_value IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The created_at field is required.';
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
  -- before inserting anything. Any exception rolls the whole RPC back.
  FOR line_row IN SELECT value FROM jsonb_array_elements(sale_line_rows)
  LOOP
    line_id_value := (line_row ->> 'id')::uuid;
    line_sale_id_value := (line_row ->> 'sale_id')::uuid;
    line_tenant_id_value := (line_row ->> 'tenant_id')::uuid;
    line_product_id_value := (line_row ->> 'product_id')::uuid;
    line_quantity_value := (line_row ->> 'quantity')::integer;
    line_unit_price_value := (line_row ->> 'unit_price_cents')::integer;
    line_unit_cost_value := NULLIF(line_row ->> 'unit_cost_cents', '')::integer;
    line_discount_value := (line_row ->> 'line_discount_cents')::integer;
    line_total_value := (line_row ->> 'line_total_cents')::integer;
    line_created_at_value := (line_row ->> 'created_at')::timestamptz;

    IF line_sale_id_value IS DISTINCT FROM sale_id_value
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

    line_total_sum := line_total_sum + line_total_value;
  END LOOP;

  IF sale_discount_value > line_total_sum THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The sale discount exceeds the sale line total.';
  END IF;

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
    line_quantity_value := (line_row ->> 'quantity')::integer;
    line_unit_price_value := (line_row ->> 'unit_price_cents')::integer;
    line_unit_cost_value := NULLIF(line_row ->> 'unit_cost_cents', '')::integer;
    line_discount_value := (line_row ->> 'line_discount_cents')::integer;
    line_total_value := (line_row ->> 'line_total_cents')::integer;
    line_created_at_value := (line_row ->> 'created_at')::timestamptz;

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

CREATE OR REPLACE FUNCTION public.powersync_void_sale(
  sale_id uuid,
  voided_by_user_id uuid,
  voided_at_value timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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

  SELECT * INTO sale_record
  FROM public.sales
  WHERE sales.id = sale_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.current_user_has_tenant(sale_record.tenant_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'The sale was not found in an accessible tenant.';
  END IF;

  -- Idempotent retry: the business action is already complete.
  IF sale_record.voided_at IS NOT NULL THEN
    RETURN sale_record.id;
  END IF;

  IF voided_at_value < sale_record.created_at
     OR voided_at_value > sale_record.created_at + interval '10 minutes' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Sales can only be voided within 10 minutes.';
  END IF;

  IF voided_at_value < clock_timestamp() - interval '24 hours'
     OR voided_at_value > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'The void timestamp is outside the accepted upload window.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.refunds
    WHERE refunds.original_sale_id = sale_record.id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'A refunded sale cannot be voided.';
  END IF;

  UPDATE public.sales
  SET voided_at = voided_at_value,
      voided_by_user_id = authenticated_user_id
  WHERE sales.id = sale_record.id;

  RETURN sale_record.id;
END;
$$;

-- Keep the legacy overload while cached clients may still upload queued voids.
CREATE OR REPLACE FUNCTION public.powersync_void_sale(
  sale_id uuid,
  voided_by_user_id uuid
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.powersync_void_sale(
    sale_id,
    voided_by_user_id,
    clock_timestamp()
  );
$$;

CREATE OR REPLACE FUNCTION public.powersync_create_refund(refund_row jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
  refund_created_at_value := (refund_row ->> 'created_at')::timestamptz;
  refund_client_created_at_value := (refund_row ->> 'client_created_at')::timestamptz;

  IF refund_id_value IS NULL
     OR tenant_id_value IS NULL
     OR refund_created_at_value IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The refund id, tenant_id, and created_at fields are required.';
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

  IF sale_record.voided_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'A voided sale cannot be refunded.';
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

-- Enforce void-window/refund rules even for trusted server writes. The RPC
-- already performs these checks; the trigger is defense in depth.
CREATE OR REPLACE FUNCTION public.sales_enforce_void_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
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

  IF NEW.voided_at < OLD.created_at
     OR NEW.voided_at > OLD.created_at + interval '10 minutes' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Sales can only be voided within 10 minutes.';
  END IF;

  IF NEW.voided_at < clock_timestamp() - interval '24 hours'
     OR NEW.voided_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'The void timestamp is outside the accepted upload window.';
  END IF;

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

-- Financial mutations must pass through the validated atomic functions.
REVOKE INSERT ON public.sales FROM authenticated;
REVOKE UPDATE ON public.sales FROM authenticated;
REVOKE DELETE ON public.sales FROM authenticated;
REVOKE INSERT ON public.sale_lines FROM authenticated;
REVOKE UPDATE ON public.sale_lines FROM authenticated;
REVOKE DELETE ON public.sale_lines FROM authenticated;
REVOKE INSERT ON public.refunds FROM authenticated;
REVOKE UPDATE ON public.refunds FROM authenticated;
REVOKE DELETE ON public.refunds FROM authenticated;

REVOKE ALL ON FUNCTION public.powersync_create_sale(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.powersync_void_sale(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.powersync_void_sale(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.powersync_create_refund(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.powersync_create_sale(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.powersync_void_sale(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.powersync_void_sale(uuid, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.powersync_create_refund(jsonb) TO authenticated;
