-- Removing a member, leaving a puesto and deleting an account's data
-- (supabase/manual/20261113120000_tenant_membership_removal.sql).

BEGIN;

\set owner a0000000-0000-4000-8000-0000000000a1
\set seller a0000000-0000-4000-8000-0000000000a2
\set helper a0000000-0000-4000-8000-0000000000a3
\set solo a0000000-0000-4000-8000-0000000000a4
\set shared a1000000-0000-4000-8000-000000000001
\set own_only a1000000-0000-4000-8000-000000000002
\set legacy a1000000-0000-4000-8000-000000000003
\set product a2000000-0000-4000-8000-000000000001
\set solo_product a2000000-0000-4000-8000-000000000002
\set seller_sale a3000000-0000-4000-8000-000000000001
\set solo_sale a3000000-0000-4000-8000-000000000002

SELECT tests.create_user(:'owner', 'owner@example.com');
SELECT tests.create_user(:'seller', 'seller@example.com');
SELECT tests.create_user(:'helper', 'helper@example.com');
SELECT tests.create_user(:'solo', 'solo@example.com');

-- The shared puesto: its creator, then a seller and a helper who joined later.
SELECT tests.create_tenant(:'shared', :'owner');
INSERT INTO public.tenant_users (tenant_id, user_id, display_name, created_at)
VALUES
  (:'shared', :'seller', 'Sole', now() + interval '1 minute'),
  (:'shared', :'helper', 'Ayudante', now() + interval '2 minutes');
SELECT tests.create_product(:'product', :'shared');
SELECT tests.create_sale(:'seller_sale', :'shared', :'seller', :'product');
UPDATE public.sales
SET voided_at = now(), voided_by_user_id = :'seller'
WHERE id = :'seller_sale';
INSERT INTO public.inventory_movements (tenant_id, product_id, user_id, delta, reason, client_created_at)
VALUES (:'shared', :'product', :'seller', 5, 'initial', now());
INSERT INTO public.tenant_invitations (tenant_id, token, created_by_user_id, expires_at)
VALUES (:'shared', 'hash-shared', :'owner', now() + interval '1 day');

-- ---------------------------------------------------------------------------
-- Devices cannot change memberships
-- ---------------------------------------------------------------------------

SELECT tests.authenticate(:'owner');
SELECT tests.is(
  tests.affected_rows(format(
    'DELETE FROM public.tenant_users WHERE tenant_id = %L AND user_id = %L',
    :'shared', :'seller'
  )),
  0,
  'a member cannot delete a membership through PostgREST, not even the owner'
);
SELECT tests.throws(
  format('SELECT public.remove_tenant_member(%L, %L, %L)', :'owner', :'shared', :'seller'),
  '42501',
  'the API roles cannot call remove_tenant_member'
);
SELECT tests.throws(
  format('SELECT public.delete_account_data(%L)', :'owner'),
  '42501',
  'the API roles cannot call delete_account_data'
);
SELECT tests.throws(
  format('INSERT INTO public.former_tenant_members (tenant_id, user_id, display_name) VALUES (%L, %L, %L)', :'shared', :'owner', 'X'),
  '42501',
  'a member cannot write former members'
);
SELECT tests.as_owner();

-- ---------------------------------------------------------------------------
-- Lock order: invitations before the tenant, as a redemption takes them
-- (remove_tenant_member and delete_account_data). The other order deadlocks a
-- redemption racing a removal or an account deletion; that race needs two
-- sessions, so these pin the order in the function bodies.
-- ---------------------------------------------------------------------------

SELECT tests.ok(
  strpos(pg_get_functiondef('public.remove_tenant_member(uuid,uuid,uuid)'::regprocedure), 'FROM public.tenant_invitations')
    < strpos(pg_get_functiondef('public.remove_tenant_member(uuid,uuid,uuid)'::regprocedure), 'FROM public.tenants WHERE id = p_tenant_id FOR UPDATE'),
  'a removal locks the invitations before the tenant'
);
SELECT tests.ok(
  strpos(pg_get_functiondef('public.delete_account_data(uuid)'::regprocedure), 'FROM public.tenant_invitations i')
    < strpos(pg_get_functiondef('public.delete_account_data(uuid)'::regprocedure), 'FROM public.tenants t'),
  'an account deletion locks the invitations before the puestos'
);

SELECT tests.ok(
  strpos(pg_get_functiondef('public.remove_tenant_member(uuid,uuid,uuid)'::regprocedure), 'invitation_create:')
    BETWEEN 1 AND strpos(pg_get_functiondef('public.remove_tenant_member(uuid,uuid,uuid)'::regprocedure), 'FROM public.tenant_invitations'),
  'a removal takes the invitation creation lock before anything else'
);
SELECT tests.ok(
  strpos(pg_get_functiondef('public.delete_account_data(uuid)'::regprocedure), 'invitation_create:')
    BETWEEN 1 AND strpos(pg_get_functiondef('public.delete_account_data(uuid)'::regprocedure), 'FROM public.tenant_invitations i'),
  'an account deletion takes the invitation creation locks before the invitations'
);

SELECT tests.ok(
  strpos(pg_get_functiondef('public.delete_account_data(uuid)'::regprocedure), 'account:')
    BETWEEN 1 AND strpos(pg_get_functiondef('public.delete_account_data(uuid)'::regprocedure), 'invitation_create:'),
  'an account deletion takes the account''s lock before anything else'
);

-- ---------------------------------------------------------------------------
-- Who may remove whom
-- ---------------------------------------------------------------------------

SELECT tests.is(
  public.tenant_owner_user_id(:'shared'), :'owner'::uuid,
  'the creator owns the puesto'
);
SELECT tests.throws(
  format('SELECT public.remove_tenant_member(%L, %L, %L)', :'seller', :'shared', :'helper'),
  'BF403',
  'a member who is not the owner cannot remove another member'
);
SELECT tests.throws(
  format('SELECT public.remove_tenant_member(%L, %L, %L)', :'seller', :'shared', :'owner'),
  'BF403',
  'a member cannot remove the owner'
);
SELECT tests.throws(
  format('SELECT public.remove_tenant_member(%L, %L, %L)', :'owner', :'shared', :'owner'),
  'BF409',
  'the owner cannot leave'
);
SELECT tests.throws(
  format('SELECT public.remove_tenant_member(%L, %L, %L)', :'solo', :'shared', :'seller'),
  'BF401',
  'someone outside the puesto cannot remove its members'
);
SELECT tests.throws(
  format('SELECT public.remove_tenant_member(%L, %L, %L)', :'owner', :'shared', :'solo'),
  'BF404',
  'removing someone who is not a member is reported'
);
SELECT tests.throws(
  format('DELETE FROM public.tenant_users WHERE tenant_id = %L AND user_id = %L', :'shared', :'owner'),
  'BF409',
  'no writer can delete the owner''s membership while others remain'
);

-- The owner removes the seller.
SELECT public.remove_tenant_member(:'owner', :'shared', :'seller');

SELECT tests.is(
  (SELECT count(*)::int FROM public.tenant_users WHERE tenant_id = :'shared' AND user_id = :'seller'),
  0,
  'the removed member''s membership is gone'
);
SELECT tests.is(
  (SELECT display_name FROM public.former_tenant_members WHERE tenant_id = :'shared' AND user_id = :'seller'),
  'Sole',
  'the removed member''s name is kept for their records'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.sales WHERE id = :'seller_sale' AND user_id = :'seller' AND voided_by_user_id = :'seller'),
  1,
  'the removed member''s sale is kept as it was'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.sale_lines WHERE sale_id = :'seller_sale'),
  1,
  'the removed member''s sale lines are kept'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.inventory_movements WHERE tenant_id = :'shared' AND user_id = :'seller'),
  1,
  'the removed member''s stock counts are kept'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.tenant_invitations WHERE tenant_id = :'shared' AND revoked_at IS NULL),
  0,
  'removing a member revokes the active invitation link'
);

-- What the removed member can still read through PostgREST: nothing.
SELECT tests.authenticate(:'seller');
SELECT tests.is(
  (SELECT count(*)::int FROM public.sales), 0,
  'a removed member reads none of the puesto''s sales'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.former_tenant_members), 0,
  'a removed member reads none of the puesto''s former members'
);
SELECT tests.authenticate(:'owner');
SELECT tests.is(
  (SELECT display_name FROM public.former_tenant_members WHERE user_id = :'seller'),
  'Sole',
  'the remaining members read the former member''s name'
);
SELECT tests.as_owner();

-- The helper leaves on their own: the link stays.
INSERT INTO public.tenant_invitations (tenant_id, token, created_by_user_id, expires_at)
VALUES (:'shared', 'hash-shared-2', :'owner', now() + interval '1 day');
SELECT public.remove_tenant_member(:'helper', :'shared', :'helper');
SELECT tests.is(
  (SELECT count(*)::int FROM public.tenant_users WHERE tenant_id = :'shared'),
  1,
  'a member can leave'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.tenant_invitations WHERE tenant_id = :'shared' AND revoked_at IS NULL),
  1,
  'leaving keeps the invitation link'
);

-- Rejoining and leaving again keeps one former member row, with the latest name.
INSERT INTO public.tenant_users (tenant_id, user_id, display_name)
VALUES (:'shared', :'helper', 'Ayudante 2');
SELECT public.remove_tenant_member(:'helper', :'shared', :'helper');
SELECT tests.is(
  (SELECT array_agg(display_name) FROM public.former_tenant_members WHERE tenant_id = :'shared' AND user_id = :'helper'),
  ARRAY['Ayudante 2'],
  'a former member has one row with their latest name'
);

-- A puesto from before created_by_user_id: its longest-standing member owns it.
INSERT INTO public.tenants (id, name) VALUES (:'legacy', 'Legacy');
INSERT INTO public.tenant_users (tenant_id, user_id, display_name, created_at)
VALUES
  (:'legacy', :'helper', 'Primera', now() - interval '1 day'),
  (:'legacy', :'seller', 'Segunda', now());
SELECT tests.is(
  public.tenant_owner_user_id(:'legacy'), :'helper'::uuid,
  'without a creator, the longest-standing member owns the puesto'
);
SELECT tests.throws(
  format('SELECT public.remove_tenant_member(%L, %L, %L)', :'seller', :'legacy', :'helper'),
  'BF403',
  'the later member of a legacy puesto cannot remove the first'
);

-- ---------------------------------------------------------------------------
-- Deleting an account's data
-- ---------------------------------------------------------------------------

SELECT tests.throws(
  format('SELECT public.delete_account_data(%L)', :'helper'),
  'BF409',
  'an owner of a puesto with other members cannot delete their account'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.tenant_users WHERE user_id = :'helper'),
  1,
  'a refused account deletion changes nothing'
);

-- A user alone in their own puesto, also selling in the shared one.
SELECT tests.create_tenant(:'own_only', :'solo');
SELECT tests.create_product(:'solo_product', :'own_only');
SELECT tests.create_sale(:'solo_sale', :'own_only', :'solo', :'solo_product');
INSERT INTO public.refunds (tenant_id, original_sale_id, user_id, client_created_at)
VALUES (:'own_only', :'solo_sale', :'solo', now());
INSERT INTO public.inventory_movements (tenant_id, product_id, user_id, delta, reason, client_created_at)
VALUES (:'own_only', :'solo_product', :'solo', 3, 'initial', now());
INSERT INTO public.tenant_invitations (tenant_id, token, created_by_user_id, expires_at)
VALUES (:'own_only', 'hash-solo', :'solo', now() + interval '1 day');
INSERT INTO public.tenant_users (tenant_id, user_id, display_name)
VALUES (:'shared', :'solo', 'Solita');
SELECT tests.create_sale(
  'a3000000-0000-4000-8000-000000000003', :'shared', :'solo', :'product'
);

SELECT tests.is(
  public.delete_account_data(:'solo'),
  ARRAY[:'own_only']::uuid[],
  'deleting an account deletes the puestos where the user is the only member'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.tenants WHERE id = :'own_only'),
  0,
  'the user''s own puesto is gone'
);
SELECT tests.is(
  (SELECT array_agg(tenant_id) FROM public.tenant_storage_cleanups),
  ARRAY[:'own_only']::uuid[],
  'the deleted puesto''s photo cleanup is recorded with the deletion'
);
SELECT tests.authenticate(:'owner');
SELECT tests.throws(
  'SELECT count(*) FROM public.tenant_storage_cleanups',
  '42501',
  'the API roles cannot read the photo cleanup queue'
);
SELECT tests.as_owner();
SELECT tests.is(
  (SELECT count(*)::int FROM public.products WHERE tenant_id = :'own_only')
    + (SELECT count(*)::int FROM public.sales WHERE tenant_id = :'own_only')
    + (SELECT count(*)::int FROM public.refunds WHERE tenant_id = :'own_only')
    + (SELECT count(*)::int FROM public.inventory_movements WHERE tenant_id = :'own_only')
    + (SELECT count(*)::int FROM public.categories WHERE tenant_id = :'own_only')
    + (SELECT count(*)::int FROM public.tenant_invitations WHERE tenant_id = :'own_only')
    + (SELECT count(*)::int FROM public.former_tenant_members WHERE tenant_id = :'own_only'),
  0,
  'and so is all of its data'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.tenant_users WHERE user_id = :'solo'),
  0,
  'the user is left with no membership'
);
SELECT tests.is(
  (SELECT count(*)::int FROM public.sales WHERE tenant_id = :'shared' AND user_id = :'solo'),
  1,
  'their sale in a shared puesto is kept'
);
SELECT tests.is(
  (SELECT display_name FROM public.former_tenant_members WHERE tenant_id = :'shared' AND user_id = :'solo'),
  'Solita',
  'and keeps their name'
);
SELECT tests.is(
  public.delete_account_data(:'solo'),
  ARRAY[]::uuid[],
  'deleting the data again is a no-op, for a retried deletion'
);

-- A soft-deleted account gets no new membership and no new puesto.
SELECT tests.create_user('a0000000-0000-4000-8000-0000000000a6', 'soft@example.com');
UPDATE auth.users SET deleted_at = now()
WHERE id = 'a0000000-0000-4000-8000-0000000000a6';
SELECT tests.throws(
  format('INSERT INTO public.tenant_users (tenant_id, user_id, display_name) VALUES (%L, %L, %L)', :'shared', 'a0000000-0000-4000-8000-0000000000a6', 'Fantasma'),
  'BF410',
  'a deleted account cannot join a puesto'
);
SELECT tests.throws(
  format('SELECT tests.create_tenant(%L, %L)', 'a1000000-0000-4000-8000-0000000000a6', 'a0000000-0000-4000-8000-0000000000a6'),
  'BF410',
  'a deleted account cannot create a puesto'
);

-- An auth user deleted outright (the Supabase dashboard) still cascades.
SELECT tests.create_user('a0000000-0000-4000-8000-0000000000a5', 'gone@example.com');
INSERT INTO public.tenant_users (tenant_id, user_id, display_name)
VALUES (:'shared', 'a0000000-0000-4000-8000-0000000000a5', 'Ida');
DELETE FROM auth.users WHERE id = 'a0000000-0000-4000-8000-0000000000a5';
SELECT tests.is(
  (SELECT display_name FROM public.former_tenant_members WHERE user_id = 'a0000000-0000-4000-8000-0000000000a5'),
  'Ida',
  'an auth user delete removes the membership and keeps the name'
);

-- The owner alone can then delete their account and the puesto with it.
SELECT tests.is(
  public.delete_account_data(:'owner'),
  ARRAY[:'shared']::uuid[],
  'once alone, the owner''s account deletion deletes the puesto'
);

ROLLBACK;
