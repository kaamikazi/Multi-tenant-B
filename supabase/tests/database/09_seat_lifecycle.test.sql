-- Seat limits through the plan lifecycle: invitations made on Pro can't
-- overfill a workspace after it downgrades to Free.
begin;
select plan(16);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
-- Signs a new person up through an invitation (the real sign-up trigger path).
create function pg_temp.accept_by_signup(uid uuid, email text, tok text) returns void language sql as $$
  insert into auth.users (id, email, raw_user_meta_data)
  values (uid, email, json_build_object('invite_token', tok)::jsonb);
$$;
create function pg_temp.tok(email text) returns text language sql as $$
  select token from public.invitations where invitations.email = tok.email
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'owner@acme.test', '{"company_name": "Acme"}');
select set_config('test.acme', (select tenant_id::text from public.users where id = 'a0000000-0000-0000-0000-000000000001'), true);

-- On Pro, the owner invites five people.
update public.tenants set plan = 'pro' where id = current_setting('test.acme')::uuid;
select pg_temp.login('a0000000-0000-0000-0000-000000000001');
insert into public.invitations (email, role) select 'p' || n || '@acme.test', 'member' from generate_series(1, 5) n;
select pg_temp.logout();

-- Downgrade to Free (3 seats) with 1 member and 5 pending invitations.
update public.tenants set plan = 'free' where id = current_setting('test.acme')::uuid;

select results_eq(
  $$ select status from public.get_invitation(pg_temp.tok('p1@acme.test')) $$,
  $$ values ('valid') $$, 'with free seats, an old invitation still shows as valid');

select lives_ok(
  $$ select pg_temp.accept_by_signup('10000000-0000-0000-0000-000000000001', 'p1@acme.test', pg_temp.tok('p1@acme.test')) $$,
  'after downgrade, an old invitation can fill a free seat (2 of 3)');
select lives_ok(
  $$ select pg_temp.accept_by_signup('10000000-0000-0000-0000-000000000002', 'p2@acme.test', pg_temp.tok('p2@acme.test')) $$,
  'the last free seat can be taken once (3 of 3)');

-- Boundary: the next acceptance is refused, even though the invite predates the downgrade.
select throws_ok(
  $$ select pg_temp.accept_by_signup('10000000-0000-0000-0000-000000000003', 'p3@acme.test', pg_temp.tok('p3@acme.test')) $$,
  '54000', null, 'an invitation created on Pro cannot be accepted once Free seats are full');

select results_eq(
  $$ select status from public.get_invitation(pg_temp.tok('p3@acme.test')) $$,
  $$ values ('no_seats') $$, 'the invite page is told there are no free seats');

select is((select count(*)::int from public.users where tenant_id = current_setting('test.acme')::uuid), 3,
  'the refused acceptance added nobody');

-- Existing accounts accepting through the RPC are held to the same rule.
insert into auth.users (id, email, raw_user_meta_data) values ('10000000-0000-0000-0000-000000000009', 'p4@acme.test', '{}');
delete from public.tenants where id = (select tenant_id from public.users where id = '10000000-0000-0000-0000-000000000009');
-- The token comes from the invite link; the invitee can't query invitations.
select set_config('test.p4', pg_temp.tok('p4@acme.test'), true);
select pg_temp.login('10000000-0000-0000-0000-000000000009');
select throws_ok(
  $$ select public.accept_invitation(current_setting('test.p4')) $$,
  '54000', null, 'an existing account accepting an old invitation is refused too');
select pg_temp.logout();

-- Back on Pro: unlimited. Accept two more, then downgrade again: over the limit.
update public.tenants set plan = 'pro' where id = current_setting('test.acme')::uuid;
select lives_ok(
  $$ select pg_temp.accept_by_signup('10000000-0000-0000-0000-000000000003', 'p3@acme.test', pg_temp.tok('p3@acme.test')) $$,
  'Pro has no seat limit');
select pg_temp.login('10000000-0000-0000-0000-000000000009');
select lives_ok($$ select public.accept_invitation(current_setting('test.p4')) $$, 'Pro accepts existing accounts too');
select pg_temp.logout();
update public.tenants set plan = 'free' where id = current_setting('test.acme')::uuid;

select pg_temp.login('a0000000-0000-0000-0000-000000000001');
select results_eq(
  'select members, seat_limit, over_limit from public.get_seat_usage()',
  $$ values (5, 3, true) $$, 'a downgraded workspace with 5 members is reported over the Free limit');

select is((select count(*)::int from public.users), 5, 'nobody is removed by a downgrade');

select throws_ok(
  $$ insert into public.invitations (email, role) values ('new@acme.test', 'member') $$,
  '54000', null, 'while over the limit, no new invitations');
select pg_temp.logout();

select throws_ok(
  $$ select pg_temp.accept_by_signup('10000000-0000-0000-0000-000000000005', 'p5@acme.test', pg_temp.tok('p5@acme.test')) $$,
  '54000', null, 'while over the limit, old invitations cannot be accepted');

-- Expiry still applies independently of seats.
update public.tenants set plan = 'pro' where id = current_setting('test.acme')::uuid;
update public.invitations set expires_at = now() - interval '1 minute' where email = 'p5@acme.test';
select throws_ok(
  $$ select pg_temp.accept_by_signup('10000000-0000-0000-0000-000000000005', 'p5@acme.test', pg_temp.tok('p5@acme.test')) $$,
  'P0001', null, 'an expired invitation is refused even on Pro');

-- A paid plan doesn't relax role rules.
select pg_temp.login('10000000-0000-0000-0000-000000000001'); -- p1, a member
select throws_ok(
  $$ insert into public.invitations (email, role) values ('friend@acme.test', 'member') $$,
  '42501', null, 'members still cannot invite on Pro');
select pg_temp.logout();

select pg_temp.logout();
set local role anon;
select results_eq(
  $$ select tenant_name, status from public.get_invitation('no-such-token') $$,
  $$ select null::text, null::text where false $$, 'unknown tokens still reveal nothing');
reset role;

select * from finish();
rollback;
