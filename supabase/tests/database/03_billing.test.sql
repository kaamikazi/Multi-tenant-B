-- Plans, billing visibility and Free-plan seat limits.
begin;
select plan(18);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true);
$$;

-- Fixtures: Acme (owner + admin + member) and Globex (owner), via sign-up.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'owner@acme.test',   '{"company_name": "Acme"}'),
  ('b0000000-0000-0000-0000-000000000001', 'owner@globex.test', '{"company_name": "Globex"}');

select set_config('test.acme', (select tenant_id::text from public.users where id = 'a0000000-0000-0000-0000-000000000001'), true);
select set_config('test.globex', (select tenant_id::text from public.users where id = 'b0000000-0000-0000-0000-000000000001'), true);

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000002', 'admin@acme.test'),
  ('a0000000-0000-0000-0000-000000000003', 'member@acme.test');
-- Move them into Acme (sign-up gave each a workspace of their own).
delete from public.tenants where id in (
  select tenant_id from public.users where id in ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003'));
insert into public.users (id, tenant_id, email, role) values
  ('a0000000-0000-0000-0000-000000000002', current_setting('test.acme')::uuid, 'admin@acme.test',  'admin'),
  ('a0000000-0000-0000-0000-000000000003', current_setting('test.acme')::uuid, 'member@acme.test', 'member');

insert into public.billing (tenant_id, stripe_customer_id) values
  (current_setting('test.acme')::uuid,   'cus_acme'),
  (current_setting('test.globex')::uuid, 'cus_globex');

-- ---------------------------------------------------------------------------
-- Plan
-- ---------------------------------------------------------------------------
select is(
  (select plan::text from public.tenants where id = current_setting('test.acme')::uuid), 'free',
  'new tenants start on the free plan'
);

select pg_temp.login('a0000000-0000-0000-0000-000000000001'); -- acme owner

select throws_ok(
  $$ update public.tenants set plan = 'pro' where id = current_setting('test.acme')::uuid $$,
  '42501', null,
  'even the owner cannot upgrade their own plan from the client'
);

select throws_ok(
  $$ update public.billing set subscription_status = 'active' $$,
  '42501', null,
  'clients cannot write billing state'
);

select throws_ok(
  $$ insert into public.billing (tenant_id) values (gen_random_uuid()) $$,
  '42501', null,
  'clients cannot create billing rows'
);

-- ---------------------------------------------------------------------------
-- Billing visibility
-- ---------------------------------------------------------------------------
select results_eq(
  'select stripe_customer_id from public.billing',
  $$ values ('cus_acme') $$,
  'owner sees only their own tenant''s billing'
);

select pg_temp.login('a0000000-0000-0000-0000-000000000002'); -- acme admin
select results_eq(
  'select stripe_customer_id from public.billing',
  $$ values ('cus_acme') $$,
  'admin can see billing'
);

select pg_temp.login('a0000000-0000-0000-0000-000000000003'); -- acme member
select is_empty('select 1 from public.billing', 'member cannot see billing');

select is(
  (select plan::text from public.tenants), 'free',
  'member can still see which plan the workspace is on'
);

select pg_temp.login('b0000000-0000-0000-0000-000000000001'); -- globex owner
select results_eq(
  'select stripe_customer_id from public.billing',
  $$ values ('cus_globex') $$,
  'another tenant''s owner sees only their own billing'
);

-- ---------------------------------------------------------------------------
-- Free plan: 3 seats (members + pending invitations)
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000001'); -- acme owner, 3 members

select results_eq(
  'select used, seat_limit from public.get_seat_usage()',
  $$ values (3, 3) $$,
  'seat usage counts members against the free limit'
);

select throws_ok(
  $$ insert into public.invitations (email, role) values ('fourth@acme.test', 'member') $$,
  '42501', null,
  'a full free workspace cannot invite anyone'
);

select pg_temp.logout();
delete from public.users where id = 'a0000000-0000-0000-0000-000000000003';
select pg_temp.login('a0000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ insert into public.invitations (email, role) values ('third@acme.test', 'member') $$,
  'freeing a seat allows one more invitation'
);

select throws_ok(
  $$ insert into public.invitations (email, role) values ('fourth@acme.test', 'member') $$,
  '42501', null,
  'pending invitations count as seats'
);

select pg_temp.logout();
update public.invitations set expires_at = now() - interval '1 minute' where email = 'third@acme.test';
select pg_temp.login('a0000000-0000-0000-0000-000000000001');

select results_eq(
  'select used from public.get_seat_usage()',
  $$ values (2) $$,
  'expired invitations do not hold a seat'
);

-- ---------------------------------------------------------------------------
-- Pro plan: unlimited seats. Only the server (postgres / secret key) upgrades.
-- ---------------------------------------------------------------------------
select pg_temp.logout();
update public.tenants set plan = 'pro' where id = current_setting('test.acme')::uuid;
select pg_temp.login('a0000000-0000-0000-0000-000000000001');

select results_eq(
  'select seat_limit from public.get_seat_usage()',
  $$ values (null::int) $$,
  'pro has no seat limit'
);

select lives_ok(
  $$ insert into public.invitations (email, role)
     select 'bulk' || n || '@acme.test', 'member' from generate_series(1, 5) n $$,
  'pro can invite beyond the free limit'
);

select pg_temp.login('b0000000-0000-0000-0000-000000000001'); -- globex owner, still free
select results_eq(
  'select used, seat_limit from public.get_seat_usage()',
  $$ values (1, 3) $$,
  'another tenant''s plan and seats are unaffected'
);

select pg_temp.login('a0000000-0000-0000-0000-000000000002'); -- acme admin
select throws_ok(
  $$ insert into public.invitations (email, role) values ('newadmin@acme.test', 'admin') $$,
  '42501', null,
  'a paid plan does not relax role rules: admins still cannot invite admins'
);

select * from finish();
rollback;
