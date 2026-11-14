-- Removing a member, leaving a puesto and deleting an account.
--
-- Run after `pnpm db:push` has applied the Drizzle migrations that create
-- public.former_tenant_members and public.tenant_storage_cleanups. Safe to
-- re-run: every statement replaces or guards what it creates.
--
-- The rules (docs/multi-tenant-invitations-prd.md, "Member removal"):
-- - A puesto's owner is the member who created it (tenants.created_by_user_id).
--   When that user is not a member (puestos from before the column existed,
--   or a creator whose auth user was deleted), the longest-standing member is.
-- - Only the owner removes other members. Any other member can leave.
-- - The owner cannot leave, or be removed, while the puesto has other members.
-- - Removing someone revokes the puesto's active invitation links, so a
--   removed member cannot come straight back through the link they joined
--   with.
-- - Sales, sale lines, refunds and stock movements are never deleted or
--   rewritten when a membership ends; the member's name moves to
--   former_tenant_members so those records keep a seller name. Only deleting
--   the account of a puesto's only member deletes that puesto and its data.
--
-- The app runs remove_tenant_member and delete_account_data on its trusted
-- server connection (app/tenants/actions.ts, app/account/actions.ts) in both
-- modes, with and without PowerSync. Devices cannot change memberships:
-- tenant_users has read policies only, so PostgREST rejects every client
-- insert, update and delete, and the functions below are not executable by
-- the API roles. The triggers hold for every writer, the SQL editor included.

-- ---------------------------------------------------------------------------
-- former_tenant_members: read by the puesto's members, written only by the
-- tenant_users delete trigger.
-- ---------------------------------------------------------------------------

ALTER TABLE "former_tenant_members" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant members can read former tenant members"
  ON "former_tenant_members";
CREATE POLICY "tenant members can read former tenant members"
ON "former_tenant_members" FOR SELECT
USING ("public"."current_user_has_tenant"("tenant_id"));

-- PowerSync replicates it with the rest of the puesto (powersync/sync-rules.yaml).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role') THEN
    GRANT SELECT ON public.former_tenant_members TO powersync_role;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
    RAISE NOTICE 'powersync publication not found; skipping former_tenant_members add';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'powersync'
      AND schemaname = 'public'
      AND tablename = 'former_tenant_members'
  ) THEN
    RETURN;
  END IF;

  ALTER PUBLICATION powersync ADD TABLE public.former_tenant_members;
END $$;

-- ---------------------------------------------------------------------------
-- tenant_storage_cleanups: Storage cleanup still owed for deleted puestos.
-- ---------------------------------------------------------------------------

-- A deleted puesto's product photos can only be removed through the Storage
-- API, after the database deletion committed. delete_account_data records
-- each puesto it deletes here, in the same transaction; the app removes the
-- photos and then the row (lib/tenant-storage-cleanup.ts), and every account
-- deletion also retries the oldest rows left by earlier failures, so a
-- failure does not leave orphaned files whose puesto ids nothing remembers.
-- Server-only: RLS with no policies, so the API roles see and change nothing.
ALTER TABLE "tenant_storage_cleanups" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_storage_cleanups FROM anon, authenticated;

-- deleted_accounts: the accounts whose deletion committed. Written only by
-- delete_account_data; the app records when the Auth side finished
-- (auth_deleted_at). Server-only: RLS with no policies.
ALTER TABLE "deleted_accounts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deleted_accounts FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- The owner
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tenant_owner_user_id(p_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT t.created_by_user_id
      FROM public.tenants t
      WHERE t.id = p_tenant_id
        AND EXISTS (
          SELECT 1
          FROM public.tenant_users tu
          WHERE tu.tenant_id = t.id
            AND tu.user_id = t.created_by_user_id
        )
    ),
    (
      SELECT tu.user_id
      FROM public.tenant_users tu
      WHERE tu.tenant_id = p_tenant_id
      ORDER BY tu.created_at, tu.id
      LIMIT 1
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- tenant_users delete triggers
-- ---------------------------------------------------------------------------

-- The owner's membership outlives every other one. A delete that cascades
-- from the tenant or from the auth user removes the rows it must, so it is
-- let through: the parent row is already gone by then.
CREATE OR REPLACE FUNCTION public.tenant_users_keep_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id)
  THEN
    RETURN OLD;
  END IF;

  IF OLD.user_id = public.tenant_owner_user_id(OLD.tenant_id)
     AND EXISTS (
       SELECT 1
       FROM public.tenant_users
       WHERE tenant_id = OLD.tenant_id
         AND id <> OLD.id
     )
  THEN
    RAISE EXCEPTION 'The owner cannot leave a puesto that has other members'
      USING ERRCODE = 'BF409';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tenant_users_keep_owner ON public.tenant_users;
CREATE TRIGGER tenant_users_keep_owner
  BEFORE DELETE ON public.tenant_users
  FOR EACH ROW
  EXECUTE FUNCTION public.tenant_users_keep_owner();

-- Keeps the name of whoever leaves, for the records they recorded. Not when
-- the puesto itself is being deleted.
CREATE OR REPLACE FUNCTION public.tenant_users_remember_former_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = OLD.tenant_id) THEN
    INSERT INTO public.former_tenant_members
      (tenant_id, user_id, display_name, removed_at)
    VALUES (OLD.tenant_id, OLD.user_id, OLD.display_name, now())
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          removed_at = EXCLUDED.removed_at;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tenant_users_remember_former_member ON public.tenant_users;
CREATE TRIGGER tenant_users_remember_former_member
  AFTER DELETE ON public.tenant_users
  FOR EACH ROW
  EXECUTE FUNCTION public.tenant_users_remember_former_member();

-- Every new membership (joining a puesto, creating one, the first sign-in's
-- bootstrap) takes the account's lock, the one delete_account_data takes
-- first, and is refused for a deleted account. A join or a new
-- puesto racing an account deletion either commits before the deletion
-- reads the memberships, and goes with the rest, or waits and is refused:
-- the deletion records the account in deleted_accounts in its own
-- transaction, before the app revokes the sessions and soft-deletes the
-- auth user (app/account/actions.ts). No transaction stays open across
-- those Auth calls.
CREATE OR REPLACE FUNCTION public.tenant_users_refuse_deleted_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('account:' || NEW.user_id::text));

  IF EXISTS (
    SELECT 1 FROM public.deleted_accounts WHERE user_id = NEW.user_id
  ) OR EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = NEW.user_id AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The account was deleted'
      USING ERRCODE = 'BF410';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenant_users_refuse_deleted_account ON public.tenant_users;
CREATE TRIGGER tenant_users_refuse_deleted_account
  BEFORE INSERT ON public.tenant_users
  FOR EACH ROW
  EXECUTE FUNCTION public.tenant_users_refuse_deleted_account();

-- ---------------------------------------------------------------------------
-- Removing a member, and leaving
-- ---------------------------------------------------------------------------

-- Locks, in this order in both functions below:
-- 1. The per-puesto advisory lock that creating an invitation link holds
--    (getOrCreateActiveInvitation in lib/invitations/repository.ts, which
--    checks the creator's membership again under it), so a member removed
--    while creating a link cannot insert a fresh one after the revoke.
-- 2. The invitation rows, then 3. the tenant row: the order an invitation
--    redemption takes them in (redeemInvitation locks the invitation, then
--    its membership insert's foreign key share-locks the tenant). Taken the
--    other way round, a redemption racing a removal or an account deletion
--    deadlocks (40P01).

-- p_actor_user_id removes p_member_user_id from the puesto, or leaves it when
-- both are the same user. Raises, without changing anything:
-- - BF401 when the actor is not a member;
-- - BF404 when the member to remove is not one;
-- - BF403 when the actor removes someone else without being the owner;
-- - BF409 when the owner tries to leave.
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

-- ---------------------------------------------------------------------------
-- Deleting an account's data
-- ---------------------------------------------------------------------------

-- Ends every membership of p_user_id. A puesto they share is left (their
-- records stay, under their former member name); a puesto where they are the
-- only member is deleted with all its data. Raises BF409, without changing
-- anything, while they own a puesto that has other members. Returns the ids
-- of the deleted puestos, whose Storage objects the caller removes. The auth
-- user itself is deleted by the caller through the Auth admin API.
CREATE OR REPLACE FUNCTION public.delete_account_data(p_user_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_deleted uuid[] := ARRAY[]::uuid[];
BEGIN
  -- First the account's own lock, which every new membership of this user
  -- takes too (tenant_users_refuse_deleted_account), then the invitation
  -- creation lock of each of their puestos, in one order, as
  -- remove_tenant_member takes it.
  PERFORM pg_advisory_xact_lock(hashtext('account:' || p_user_id::text));

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

  -- From the commit on, the account gets no new membership or puesto
  -- (tenant_users_refuse_deleted_account), whatever happens to the Auth
  -- steps that follow it.
  INSERT INTO public.deleted_accounts (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

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

-- Only the trusted server connection calls these; triggers are never called
-- directly.
REVOKE ALL ON FUNCTION public.tenant_owner_user_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_users_keep_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_users_remember_former_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_users_refuse_deleted_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_tenant_member(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_account_data(uuid) FROM PUBLIC, anon, authenticated;
