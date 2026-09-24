-- Sign-up provisioning, invitations and role management.
begin;
select plan(37);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true);
$$;

-- ---------------------------------------------------------------------------
-- Sign-up without an invite creates a tenant and makes the user its owner
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000001', 'olivia@northwind.test',
   '{"company_name": "Northwind Traders", "full_name": "Olivia Owner"}');

select results_eq(
  $$ select t.name, t.slug, u.role::text, u.full_name
       from public.users u join public.tenants t on t.id = u.tenant_id
      where u.id = '10000000-0000-0000-0000-000000000001' $$,
  $$ values ('Northwind Traders', 'northwind-traders', 'owner', 'Olivia Owner') $$,
  'sign-up creates a tenant with a slug and makes the user its owner'
);

insert into auth.users (id, email, raw_user_meta_data) values
  ('20000000-0000-0000-0000-000000000001', 'other@northwind2.test', '{"company_name": "Northwind Traders"}');

select matches(
  (select t.slug from public.tenants t join public.users u on u.tenant_id = t.id
    where u.id = '20000000-0000-0000-0000-000000000001'),
  '^northwind-traders-[0-9a-f]{6}$',
  'a duplicate company name gets a unique slug'
);

insert into auth.users (id, email) values
  ('30000000-0000-0000-0000-000000000001', 'solo@example.test');

select is(
  (select t.name from public.tenants t join public.users u on u.tenant_id = t.id
    where u.id = '30000000-0000-0000-0000-000000000001'),
  'solo''s workspace',
  'sign-up without a company name gets a default workspace'
);

-- ---------------------------------------------------------------------------
-- Owner invites an admin; admin invites a member
-- ---------------------------------------------------------------------------
select pg_temp.login('10000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ insert into public.invitations (email, role) values ('adam@northwind.test', 'admin') $$,
  'owner can invite an admin'
);

select throws_ok(
  $$ insert into public.invitations (email, role) values ('x@northwind.test', 'owner') $$,
  '23514', null,
  'nobody can invite an owner'
);

select throws_ok(
  $$ insert into public.invitations (tenant_id, email, role)
     values ((select id from public.tenants limit 1), 'x@northwind.test', 'member') $$,
  '42501', null,
  'clients cannot choose the tenant of an invitation'
);

select pg_temp.logout();

-- Adam signs up through the invite link
insert into auth.users (id, email, raw_user_meta_data)
select '10000000-0000-0000-0000-000000000002', 'adam@northwind.test',
       json_build_object('invite_token', token, 'full_name', 'Adam Admin')::jsonb
  from public.invitations where email = 'adam@northwind.test';

select results_eq(
  $$ select u.role::text, t.name from public.users u join public.tenants t on t.id = u.tenant_id
      where u.id = '10000000-0000-0000-0000-000000000002' $$,
  $$ values ('admin', 'Northwind Traders') $$,
  'signing up with an invite joins the inviting tenant with the invited role'
);

select isnt(
  (select accepted_at from public.invitations where email = 'adam@northwind.test'), null,
  'the invitation is marked accepted'
);

select is(
  (select count(*)::int from public.tenants where name = 'adam''s workspace'), 0,
  'an invited user does not get a tenant of their own'
);

select throws_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     select '10000000-0000-0000-0000-000000000009', 'someone-else@evil.test',
            json_build_object('invite_token', token)::jsonb
       from public.invitations where email = 'adam@northwind.test' $$,
  'P0001', null,
  'an invitation cannot be reused'
);

select pg_temp.login('10000000-0000-0000-0000-000000000002');

select lives_ok(
  $$ insert into public.invitations (email, role) values ('mia@northwind.test', 'member') $$,
  'admin can invite a member'
);

select throws_ok(
  $$ insert into public.invitations (email, role) values ('eve@northwind.test', 'admin') $$,
  '42501', null,
  'admin cannot invite an admin'
);

select pg_temp.logout();

-- Invite for mia, but someone with a different email tries to use it
select throws_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     select '10000000-0000-0000-0000-000000000008', 'mallory@evil.test',
            json_build_object('invite_token', token)::jsonb
       from public.invitations where email = 'mia@northwind.test' $$,
  'P0001', null,
  'an invitation only works for the email it was sent to'
);

insert into auth.users (id, email, raw_user_meta_data)
select '10000000-0000-0000-0000-000000000003', 'mia@northwind.test',
       json_build_object('invite_token', token)::jsonb
  from public.invitations where email = 'mia@northwind.test';

insert into auth.users (id, email, raw_user_meta_data)
select '10000000-0000-0000-0000-000000000004', 'max@northwind.test', '{}'::jsonb;
-- (max gets his own workspace; used below as an outsider)

-- Expired invitation
insert into public.invitations (tenant_id, email, role, expires_at)
select tenant_id, 'late@northwind.test', 'member', now() - interval '1 day'
  from public.users where id = '10000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select status from public.get_invitation(
       (select token from public.invitations where email = 'late@northwind.test')) $$,
  $$ values ('expired') $$,
  'get_invitation reports expired invitations'
);

select throws_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data)
     select '10000000-0000-0000-0000-000000000007', 'late@northwind.test',
            json_build_object('invite_token', token)::jsonb
       from public.invitations where email = 'late@northwind.test' $$,
  'P0001', null,
  'an expired invitation cannot be used'
);

-- ---------------------------------------------------------------------------
-- Visibility of invitations
-- ---------------------------------------------------------------------------
select pg_temp.login('10000000-0000-0000-0000-000000000003'); -- mia, member

select is_empty('select 1 from public.invitations', 'members cannot see invitations');

select throws_ok(
  $$ insert into public.invitations (email, role) values ('friend@northwind.test', 'member') $$,
  '42501', null,
  'members cannot invite'
);

select pg_temp.login('10000000-0000-0000-0000-000000000004'); -- max, other tenant owner

select is_empty(
  $$ select 1 from public.invitations where email like '%@northwind.test' $$,
  'another tenant''s owner cannot see northwind invitations'
);

select pg_temp.logout();
set local role anon;

select results_eq(
  $$ select tenant_name, role::text, status from public.get_invitation(
       (select 'no-such-token')) $$,
  $$ select null::text, null::text, null::text where false $$,
  'get_invitation returns nothing for an unknown token'
);

reset role;

-- ---------------------------------------------------------------------------
-- Role changes
-- ---------------------------------------------------------------------------
select pg_temp.login('10000000-0000-0000-0000-000000000002'); -- adam, admin

select throws_ok(
  $$ select public.set_member_role('10000000-0000-0000-0000-000000000003', 'admin') $$,
  '42501', null,
  'admin cannot promote a member to admin'
);

select throws_ok(
  $$ select public.transfer_ownership('10000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'admin cannot take ownership'
);

select pg_temp.login('10000000-0000-0000-0000-000000000003'); -- mia, member

select throws_ok(
  $$ select public.set_member_role('10000000-0000-0000-0000-000000000003', 'admin') $$,
  '42501', null,
  'member cannot promote themselves through the RPC'
);

select pg_temp.login('10000000-0000-0000-0000-000000000001'); -- olivia, owner

select throws_ok(
  $$ select public.set_member_role('10000000-0000-0000-0000-000000000001', 'member') $$,
  'P0001', null,
  'owner cannot change their own role'
);

select throws_ok(
  $$ select public.set_member_role('10000000-0000-0000-0000-000000000003', 'owner') $$,
  'P0001', null,
  'set_member_role cannot create a second owner'
);

select throws_ok(
  $$ select public.set_member_role('10000000-0000-0000-0000-000000000004', 'admin') $$,
  'P0002', null,
  'owner cannot change the role of a user in another tenant'
);

select lives_ok(
  $$ select public.set_member_role('10000000-0000-0000-0000-000000000003', 'admin') $$,
  'owner can promote a member to admin'
);

select lives_ok(
  $$ select public.set_member_role('10000000-0000-0000-0000-000000000003', 'member') $$,
  'owner can demote an admin to member'
);

-- ---------------------------------------------------------------------------
-- Removing users
-- ---------------------------------------------------------------------------
select pg_temp.login('10000000-0000-0000-0000-000000000003'); -- mia, member

select is_empty(
  $$ delete from public.users where id = '10000000-0000-0000-0000-000000000002' returning id $$,
  'member cannot remove anyone'
);

select pg_temp.login('10000000-0000-0000-0000-000000000002'); -- adam, admin

select is_empty(
  $$ delete from public.users where id = '10000000-0000-0000-0000-000000000001' returning id $$,
  'admin cannot remove the owner'
);

select is_empty(
  $$ delete from public.users where id = '10000000-0000-0000-0000-000000000002' returning id $$,
  'admin cannot remove themselves'
);

select is_empty(
  $$ delete from public.users where id = '10000000-0000-0000-0000-000000000004' returning id $$,
  'admin cannot remove a user in another tenant'
);

select isnt_empty(
  $$ delete from public.users where id = '10000000-0000-0000-0000-000000000003' returning id $$,
  'admin can remove a member'
);

-- ---------------------------------------------------------------------------
-- A removed user can be re-invited and accept with their existing account
-- ---------------------------------------------------------------------------
select pg_temp.login('10000000-0000-0000-0000-000000000001'); -- olivia, owner
insert into public.invitations (email, role) values ('mia@northwind.test', 'member');
-- Mia gets the token from her invite link; she cannot query invitations herself.
select set_config('test.mia_token',
  (select token from public.invitations where email = 'mia@northwind.test' and accepted_at is null), true);

select pg_temp.login('10000000-0000-0000-0000-000000000003'); -- mia, now tenantless
select is_empty('select 1 from public.users', 'a removed user sees nothing');

select lives_ok(
  $$ select public.accept_invitation(current_setting('test.mia_token')) $$,
  'an existing account without a tenant can accept an invitation'
);

-- ---------------------------------------------------------------------------
-- Ownership transfer
-- ---------------------------------------------------------------------------
select pg_temp.login('10000000-0000-0000-0000-000000000001'); -- olivia, owner

select lives_ok(
  $$ select public.transfer_ownership('10000000-0000-0000-0000-000000000002') $$,
  'owner can transfer ownership'
);

select results_eq(
  $$ select full_name, role::text from public.users
      where id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')
      order by full_name $$,
  $$ values ('Adam Admin', 'owner'), ('Olivia Owner', 'admin') $$,
  'after transfer the new owner is owner and the old owner is admin'
);

select pg_temp.login('10000000-0000-0000-0000-000000000002'); -- adam, now owner

select isnt_empty(
  $$ delete from public.users where id = '10000000-0000-0000-0000-000000000001' returning id $$,
  'the owner can remove an admin'
);

select * from finish();
rollback;
