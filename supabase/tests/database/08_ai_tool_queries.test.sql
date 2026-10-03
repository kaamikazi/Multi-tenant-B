-- AI tool queries: bounded, aggregated in SQL, and still subject to RLS.
begin;
select plan(12);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'owner@acme.test',   '{"company_name": "Acme", "full_name": "Ann Owner"}'),
  ('b0000000-0000-0000-0000-000000000001', 'owner@globex.test', '{"company_name": "Globex"}');
select set_config('test.acme', (select tenant_id::text from public.users where id = 'a0000000-0000-0000-0000-000000000001'), true);
select set_config('test.globex', (select tenant_id::text from public.users where id = 'b0000000-0000-0000-0000-000000000001'), true);

-- 40 open Acme leads (more than any tool may return), 2 closed, 1 unassigned.
insert into public.leads (tenant_id, name, source, status, budget_usd, company_size, owner_id, last_engaged_at)
select current_setting('test.acme')::uuid, 'Lead ' || n, 'referral', 'new', 60000, 300,
       'a0000000-0000-0000-0000-000000000001', now() - interval '1 day'
  from generate_series(1, 39) n;
insert into public.leads (tenant_id, name, source, status) values
  (current_setting('test.acme')::uuid, 'Loose end', 'other', 'contacted'),
  (current_setting('test.acme')::uuid, 'Won deal', 'referral', 'won'),
  (current_setting('test.acme')::uuid, 'Lost deal', 'referral', 'lost');
insert into public.leads (tenant_id, name, source) values (current_setting('test.globex')::uuid, 'Globex secret', 'referral');

insert into public.appointments (tenant_id, starts_at, ends_at, name, email, status, lead_id)
select current_setting('test.acme')::uuid, now() + make_interval(hours => n), now() + make_interval(hours => n, mins => 30),
       'Meeting ' || n, 'm@acme.test', case when n = 1 then 'cancelled'::public.appointment_status else 'booked' end,
       (select id from public.leads where name = 'Lead 1')
  from generate_series(1, 60) n;
insert into public.appointments (tenant_id, starts_at, ends_at, name, email)
values (current_setting('test.globex')::uuid, now() + interval '2 hours', now() + interval '150 minutes', 'Globex secret meeting', 'g@globex.test');

select pg_temp.login('a0000000-0000-0000-0000-000000000001');

select results_eq(
  'select team_size, owners, admins, members from public.ai_team_overview()',
  $$ values (1, 1, 0, 0) $$, 'team overview counts only the caller''s tenant');

select results_eq(
  $$ select total_leads, open_leads, open_hot, unassigned_open, won, lost from public.ai_pipeline_summary() $$,
  $$ values (42, 40, 39, 1, 1, 1) $$, 'pipeline summary aggregates in SQL, within the tenant');

select is((select count(*)::int from public.ai_list_leads(p_limit => 1000)), 25, 'lead lists are capped at 25 whatever is asked');
select is((select count(*)::int from public.ai_list_leads(p_limit => -5)), 1, 'nonsense limits are clamped');
select is((select owner_name from public.ai_list_leads(p_limit => 1)), 'Ann Owner', 'owner names are resolved by a join, not a table scan');
select is((select count(*)::int from public.ai_list_leads(p_status => 'won')), 1, 'status filters work');
select is_empty($$ select 1 from public.ai_list_leads(p_status => 'all', p_limit => 25) where name like 'Globex%' $$,
  'lead lists never include another tenant''s leads');

select is((select count(*)::int from public.ai_list_appointments(now(), now() + interval '30 days', p_limit => 500)), 50,
  'appointment lists are capped at 50');
select is((select count(*)::int from public.ai_list_appointments(now(), now() + interval '90 minutes')), 0,
  'cancelled meetings are excluded by default');
select is((select lead_name from public.ai_list_appointments(now(), now() + interval '30 days', p_limit => 1)), 'Lead 1',
  'lead names are resolved in the same query');
select is_empty($$ select 1 from public.ai_list_appointments(now(), now() + interval '30 days', true, false, 50) where name like 'Globex%' $$,
  'appointment lists never include another tenant''s meetings');

select pg_temp.logout();
set local role anon;
select throws_ok('select * from public.ai_pipeline_summary()', '42501', null, 'anonymous callers cannot use the AI queries');
reset role;

select * from finish();
rollback;
