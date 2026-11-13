-- Serialize member removal and account deletion with invitation creation.
--
-- Run after 20261113140000_membership_lock_order.sql. Safe to re-run.
--
-- Creating an invitation link (getOrCreateActiveInvitation in
-- lib/invitations/repository.ts) holds a per-tenant advisory lock,
-- hashtext('invitation_create:' || tenant_id), and checked the creator's
-- membership only before its transaction. A member removed while creating a
-- link could therefore insert a fresh one right after the removal had
-- revoked the old ones, and keep a way back in. remove_tenant_member and
-- delete_account_data now take that same lock first (then the invitations,
-- then the tenant, as before), and creation checks the creator's membership
-- again once it holds the lock. Otherwise the functions are unchanged.

CREATE OR REPLACE FUNCTION public.remove_tenant_member(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_member_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
BEGIN
  -- First the lock invitation creation takes (getOrCreateActiveInvitation in
  -- lib/invitations/repository.ts), so a link cannot be created in the middle
  -- of this change and outlive the revoke below; creation checks the
  -- creator's membership again once it holds this lock.
  PERFORM pg_advisory_xact_lock(hashtext('invitation_create:' || p_tenant_id::text));

  -- The active invitations next, then the tenant: the order an invitation
  -- redemption takes them in (redeemInvitation locks the invitation, then
  -- its membership insert's foreign key share-locks the tenant). Taken the
  -- other way round, a removal and a redemption deadlock. Only a removal
  -- revokes invitations, so leaving does not wait for redemptions.
  IF p_member_user_id IS DISTINCT FROM p_actor_user_id THEN
    PERFORM 1
    FROM public.tenant_invitations
    WHERE tenant_id = p_tenant_id
      AND revoked_at IS NULL
    ORDER BY id
    FOR UPDATE;
  END IF;

  -- One membership change per puesto at a time, so two removals (or a
  -- removal and a leave) never pass their checks against the same state.
  -- The checks below, and the revoke's revoked_at filter, run once both
  -- locks are held.
  PERFORM 1 FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'The user is not a member of the puesto'
      USING ERRCODE = 'BF401';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = p_tenant_id AND user_id = p_member_user_id
  ) THEN
    RAISE EXCEPTION 'The member is not part of the puesto'
      USING ERRCODE = 'BF404';
  END IF;

  v_owner := public.tenant_owner_user_id(p_tenant_id);
  IF p_member_user_id = p_actor_user_id THEN
    IF p_actor_user_id = v_owner THEN
      RAISE EXCEPTION 'The owner cannot leave the puesto'
        USING ERRCODE = 'BF409';
    END IF;
  ELSIF p_actor_user_id IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Only the owner can remove members'
      USING ERRCODE = 'BF403';
  END IF;

  DELETE FROM public.tenant_users
  WHERE tenant_id = p_tenant_id AND user_id = p_member_user_id;

  IF p_member_user_id <> p_actor_user_id THEN
    UPDATE public.tenant_invitations
    SET revoked_at = now()
    WHERE tenant_id = p_tenant_id
      AND revoked_at IS NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_account_data(p_user_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_deleted uuid[] := ARRAY[]::uuid[];
BEGIN
  -- First the invitation creation lock of each of their puestos, in one
  -- order, as remove_tenant_member takes it.
  PERFORM pg_advisory_xact_lock(hashtext('invitation_create:' || tenant_id::text))
  FROM (
    SELECT tenant_id FROM public.tenant_users
    WHERE user_id = p_user_id
    ORDER BY tenant_id
  ) AS mine;

  -- Their invitations next (deleting a puesto deletes them), then the
  -- puestos, each in one order: the order a redemption takes them in, see
  -- remove_tenant_member.
  PERFORM 1
  FROM public.tenant_invitations i
  WHERE i.tenant_id IN (
    SELECT tenant_id FROM public.tenant_users WHERE user_id = p_user_id
  )
  ORDER BY i.id
  FOR UPDATE;

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

REVOKE ALL ON FUNCTION public.remove_tenant_member(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_account_data(uuid) FROM PUBLIC, anon, authenticated;
