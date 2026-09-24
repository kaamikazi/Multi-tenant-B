-- Leads: tenant isolation, role rules, and the scoring model.
begin;
select plan(24);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true);
$$;

-- Acme: owner, admin, two members. Globex: owner.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'owner@acme.test',   '{"company_name": "Acme"}'),
  ('b0000000-0000-0000-0000-000000000001', 'owner@globex.test', '{"company_name": "Globex"}'),
  ('a0000000-0000-0000-0000-000000000002', 'admin@acme.test',   '{}'),
  ('a0000000-0000-0000-0000-000000000003', 'mia@acme.test',     '{}'),
  ('a0000000-0000-0000-0000-000000000004', 'max@acme.test',     '{}');
select set_config('test.acme', (select tenant_id::text from public.users where id = 'a0000000-0000-0000-0000-000000000001'), true);
delete from public.tenants where id in (select tenant_id from public.users where id in (
  'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004'));
insert into public.users (id, tenant_id, email, role) values
  ('a0000000-0000-0000-0000-000000000002', current_setting('test.acme')::uuid, 'admin@acme.test', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', current_setting('test.acme')::uuid, 'mia@acme.test',   'member'),
  ('a0000000-0000-0000-0000-000000000004', current_setting('test.acme')::uuid, 'max@acme.test',   'member');

-- ---------------------------------------------------------------------------
-- Scoring model (pure function, no tenant involved)
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select score, tier from private.score_lead(250, 60000, 'referral', now() - interval '1 day') $$,
  $$ values (100, 'hot') $$,
  'a big, well-funded, recently engaged referral scores 100 (hot)'
);

select results_eq(
  $$ select score, tier from private.score_lead(20, 8000, 'webinar', now() - interval '10 days') $$,
  $$ values (58, 'warm') $$,
  'a mid-sized webinar lead engaged 10 days ago scores 58 (warm)'
);

select results_eq(
  $$ select score, tier from private.score_lead(null, null, 'cold_outreach', null) $$,
  $$ values (6, 'cold') $$,
  'an unknown, never-engaged cold-outreach lead scores 6 (cold)'
);

select results_eq(
  $$ select score, tier from private.score_lead(null, 5000, 'demo_request', null) $$,
  $$ values (40, 'warm') $$,
  'exactly 40 points is warm, not cold'
);

select results_eq(
  $$ select score from private.score_lead(20, 8000, 'webinar', now() - interval '200 days') $$,
  $$ values (40) $$,
  'engagement older than 90 days earns no recency points'
);

select results_eq(
  $$ select b ->> 'factor', (b ->> 'points')::int, (b ->> 'max')::int, b ->> 'reason'
       from private.score_lead(20, 8000, 'webinar', now() - interval '10 days') s,
            jsonb_array_elements(s.breakdown) b $$,
  $$ values ('Budget', 12, 25, '$8,000 budget'),
            ('Company size', 8, 15, '20 employees'),
            ('Source', 20, 30, 'Attended a webinar'),
            ('Recency', 18, 30, 'Engaged 10 days ago') $$,
  'the breakdown explains every point, per factor, with a reason'
);

-- ---------------------------------------------------------------------------
-- Creating leads
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000003'); -- mia, member

select lives_ok(
  $$ insert into public.leads (name, company, budget_usd, company_size, source, owner_id, last_engaged_at)
     values ('Mia''s lead', 'Initech', 60000, 250, 'referral', 'a0000000-0000-0000-0000-000000000003', now()) $$,
  'a member can add a lead'
);

select results_eq(
  $$ select tenant_id::text, created_by::text, score, tier from public.leads_scored where name = 'Mia''s lead' $$,
  $$ values (current_setting('test.acme'), 'a0000000-0000-0000-0000-000000000003', 100, 'hot') $$,
  'tenant and creator come from the session; the view adds the score'
);

select throws_ok(
  $$ insert into public.leads (tenant_id, name) values (gen_random_uuid(), 'x') $$,
  '42501', null,
  'clients cannot choose a lead''s tenant'
);

select throws_ok(
  $$ insert into public.leads (name, owner_id) values ('Poached', 'b0000000-0000-0000-0000-000000000001') $$,
  '23503', null,
  'a lead cannot be assigned to someone in another tenant'
);

select pg_temp.login('a0000000-0000-0000-0000-000000000002'); -- admin
insert into public.leads (name, company, source, owner_id)
values ('Max''s lead', 'Globodyne', 'webinar', 'a0000000-0000-0000-0000-000000000004'),
       ('Unassigned lead', 'Hooli', 'social', null);

-- ---------------------------------------------------------------------------
-- Editing and deleting
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000003'); -- mia, member

select results_eq(
  'select count(*)::int from public.leads_scored',
  $$ values (3) $$,
  'members see every lead in their tenant'
);

select isnt_empty(
  $$ update public.leads set status = 'contacted' where name = 'Mia''s lead' returning id $$,
  'a member can edit a lead assigned to them'
);

select is_empty(
  $$ update public.leads set status = 'lost' where name = 'Max''s lead' returning id $$,
  'a member cannot edit someone else''s lead'
);

select is_empty(
  $$ update public.leads set status = 'won' where name = 'Unassigned lead' returning id $$,
  'a member cannot edit an unassigned lead'
);

select throws_ok(
  $$ update public.leads set owner_id = 'a0000000-0000-0000-0000-000000000004' where name = 'Mia''s lead' $$,
  '42501', null,
  'a member cannot hand their lead to someone else'
);

select is_empty(
  $$ delete from public.leads where name = 'Mia''s lead' returning id $$,
  'a member cannot delete leads, even their own'
);

select pg_temp.login('a0000000-0000-0000-0000-000000000002'); -- admin

select isnt_empty(
  $$ update public.leads set owner_id = 'a0000000-0000-0000-0000-000000000003' where name = 'Unassigned lead' returning id $$,
  'an admin can assign any lead'
);

select isnt_empty(
  $$ delete from public.leads where name = 'Max''s lead' returning id $$,
  'an admin can delete a lead'
);

select throws_ok(
  $$ update public.leads set tenant_id = gen_random_uuid() $$,
  '42501', null,
  'nobody can move a lead to another tenant'
);

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------
select pg_temp.login('b0000000-0000-0000-0000-000000000001'); -- globex owner

select is_empty('select 1 from public.leads', 'another tenant sees no leads');
select is_empty('select 1 from public.leads_scored', 'the scored view respects RLS too');

select is_empty(
  $$ update public.leads set name = 'pwned' returning id $$,
  'another tenant cannot edit leads'
);

select pg_temp.logout();
set local role anon;
select throws_ok('select 1 from public.leads_scored', '42501', null, 'anon cannot read the scored view');
reset role;

-- A removed teammate's leads become unassigned rather than disappearing.
delete from public.users where id = 'a0000000-0000-0000-0000-000000000003';
select results_eq(
  $$ select count(*)::int, count(owner_id)::int from public.leads $$,
  $$ values (2, 0) $$,
  'removing a teammate unassigns their leads instead of deleting them'
);

select * from finish();
rollback;
