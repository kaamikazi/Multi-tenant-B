-- Tenant isolation and RBAC tests. Run with: npx supabase test db
begin;
select plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures (run as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'owner@acme.test'),
  ('a0000000-0000-0000-0000-000000000002', 'member@acme.test'),
  ('b0000000-0000-0000-0000-000000000001', 'owner@globex.test'),
  ('c0000000-0000-0000-0000-000000000001', 'orphan@nowhere.test');

-- The sign-up trigger (Phase 2) gives every new auth user a workspace. These
-- fixtures build their tenants by hand, so drop the auto-created ones.
delete from public.tenants
 where id in (select tenant_id from public.users where id in (select id from auth.users where email like '%.test'));

insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Acme',   'acme'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Globex', 'globex');

insert into public.users (id, tenant_id, email, role) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'owner@acme.test',   'owner'),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000000', 'member@acme.test',  'member'),
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000000', 'owner@globex.test', 'owner');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true);
$$;

-- ---------------------------------------------------------------------------
-- Schema guards: catch a future table that forgets RLS or anon lockdown
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select tablename from pg_tables where schemaname = 'public' and not rowsecurity $$,
  'every table in public has RLS enabled'
);

select is_empty(
  $$ select table_name from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon' $$,
  'anon has no privileges on any public table'
);

select is_empty(
  $$ select c.table_name from information_schema.columns c
     join pg_tables t on t.schemaname = c.table_schema and t.tablename = c.table_name
     where c.table_schema = 'public' and c.table_name <> 'tenants'
     group by c.table_name
     having not bool_or(c.column_name = 'tenant_id') $$,
  'every public table except tenants has a tenant_id column'
);

-- ---------------------------------------------------------------------------
-- Acme owner
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000001');

select results_eq(
  'select slug from public.tenants',
  $$ values ('acme') $$,
  'acme owner sees only their own tenant'
);

select results_eq(
  'select email from public.users order by email',
  $$ values ('member@acme.test'), ('owner@acme.test') $$,
  'acme owner sees only acme users'
);

select is_empty(
  $$ select 1 from public.tenants where id = 'bbbbbbbb-0000-0000-0000-000000000000' $$,
  'acme owner cannot read globex by id'
);

select is_empty(
  $$ select 1 from public.users where id = 'b0000000-0000-0000-0000-000000000001' $$,
  'acme owner cannot read a globex user by id'
);

select is_empty(
  $$ update public.tenants set name = 'pwned' where id = 'bbbbbbbb-0000-0000-0000-000000000000' returning id $$,
  'acme owner cannot rename globex'
);

select is_empty(
  $$ update public.users set full_name = 'pwned' where id = 'b0000000-0000-0000-0000-000000000001' returning id $$,
  'acme owner cannot edit a globex user'
);

select isnt_empty(
  $$ update public.tenants set name = 'Acme Inc' where id = 'aaaaaaaa-0000-0000-0000-000000000000' returning id $$,
  'acme owner can rename their own tenant'
);

select throws_ok(
  $$ update public.users set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a user cannot move themselves into another tenant'
);

select throws_ok(
  $$ insert into public.users (id, tenant_id, email, role) values
     ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'orphan@nowhere.test', 'admin') $$,
  '42501', null,
  'clients cannot insert users directly'
);

select throws_ok(
  $$ insert into public.tenants (name, slug) values ('Evil', 'evil') $$,
  '42501', null,
  'clients cannot insert tenants directly'
);

select throws_ok(
  $$ delete from public.tenants $$,
  '42501', null,
  'clients cannot delete tenants'
);

-- ---------------------------------------------------------------------------
-- Acme member
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000002');

select throws_ok(
  $$ update public.users set role = 'owner' where id = 'a0000000-0000-0000-0000-000000000002' $$,
  '42501', null,
  'a member cannot promote themselves'
);

select is_empty(
  $$ update public.tenants set name = 'Member Co' returning id $$,
  'a member cannot rename the tenant'
);

select is_empty(
  $$ update public.users set full_name = 'Hijacked' where id = 'a0000000-0000-0000-0000-000000000001' returning id $$,
  'a member cannot edit another user''s profile in the same tenant'
);

select isnt_empty(
  $$ update public.users set full_name = 'Mia Member' where id = 'a0000000-0000-0000-0000-000000000002' returning id $$,
  'a member can edit their own profile'
);

-- ---------------------------------------------------------------------------
-- Authenticated user with no tenant, and anonymous visitors
-- ---------------------------------------------------------------------------
select pg_temp.login('c0000000-0000-0000-0000-000000000001');

select is_empty('select 1 from public.tenants union all select 1 from public.users',
  'a user with no tenant sees nothing');

select pg_temp.logout();
set local role anon;

select throws_ok('select 1 from public.tenants', '42501', null, 'anon cannot read tenants');
select throws_ok('select 1 from public.users',   '42501', null, 'anon cannot read users');

reset role;

-- ---------------------------------------------------------------------------
-- Cross-check as superuser that the blocked writes really did nothing
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select name from public.tenants order by slug $$,
  $$ values ('Acme Inc'), ('Globex') $$,
  'only the legitimate rename was persisted'
);

select * from finish();
rollback;
