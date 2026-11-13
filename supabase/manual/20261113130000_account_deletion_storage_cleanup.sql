-- Durable Storage cleanup for puestos deleted with an account.
--
-- Run after `pnpm db:push` has applied the Drizzle migration that creates
-- public.tenant_storage_cleanups, and after
-- 20261113120000_tenant_membership_removal.sql. Safe to re-run.
--
-- A deleted puesto's product photos can only be removed through the Storage
-- API, after the database deletion committed, so a failure there used to
-- leave orphaned files whose puesto ids nothing remembered. delete_account_data
-- now records each puesto it deletes in tenant_storage_cleanups, in the same
-- transaction. The app removes the photos and then the row
-- (lib/tenant-storage-cleanup.ts), and every account deletion also retries the
-- oldest rows left by earlier failures, so the work does not depend on the
-- session of the user who asked for it.

-- Server-only: RLS with no policies, so the API roles see and change nothing.
ALTER TABLE "tenant_storage_cleanups" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_storage_cleanups FROM anon, authenticated;

-- Same as 20261113120000's, plus the cleanup row before each tenant delete.
CREATE OR REPLACE FUNCTION public.delete_account_data(p_user_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_deleted uuid[] := ARRAY[]::uuid[];
BEGIN
  -- Lock the user's puestos in one order, as remove_tenant_member does one.
  PERFORM 1
  FROM public.tenants t
  WHERE t.id IN (
    SELECT tenant_id FROM public.tenant_users WHERE user_id = p_user_id
  )
  ORDER BY t.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.tenant_users tu
    WHERE tu.user_id = p_user_id
      AND public.tenant_owner_user_id(tu.tenant_id) = p_user_id
      AND EXISTS (
        SELECT 1 FROM public.tenant_users other
        WHERE other.tenant_id = tu.tenant_id
          AND other.user_id <> p_user_id
      )
  ) THEN
    RAISE EXCEPTION 'The user owns a puesto that has other members'
      USING ERRCODE = 'BF409';
  END IF;

  FOR v_tenant_id IN
    SELECT tenant_id FROM public.tenant_users
    WHERE user_id = p_user_id
    ORDER BY tenant_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.tenant_users
      WHERE tenant_id = v_tenant_id AND user_id <> p_user_id
    ) THEN
      DELETE FROM public.tenant_users
      WHERE tenant_id = v_tenant_id AND user_id = p_user_id;
    ELSE
      -- Children first: the ledger tables restrict the tenant delete.
      DELETE FROM public.refunds WHERE tenant_id = v_tenant_id;
      DELETE FROM public.sale_lines WHERE tenant_id = v_tenant_id;
      DELETE FROM public.sales WHERE tenant_id = v_tenant_id;
      DELETE FROM public.inventory_movements WHERE tenant_id = v_tenant_id;
      DELETE FROM public.products WHERE tenant_id = v_tenant_id;
      DELETE FROM public.categories WHERE tenant_id = v_tenant_id;
      -- Its Storage photos go after the commit, through the Storage API;
      -- recorded here so a failure there is retried, not forgotten.
      INSERT INTO public.tenant_storage_cleanups (tenant_id)
      VALUES (v_tenant_id)
      ON CONFLICT (tenant_id) DO NOTHING;
      -- Cascades to tenant_users, tenant_invitations and former_tenant_members.
      DELETE FROM public.tenants WHERE id = v_tenant_id;
      v_deleted := v_deleted || v_tenant_id;
    END IF;
  END LOOP;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_account_data(uuid) FROM PUBLIC, anon, authenticated;
