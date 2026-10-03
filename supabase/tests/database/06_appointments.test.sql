-- Appointments: public booking, no double-booking, lead linking, access rules.
begin;
select plan(31);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.visitor() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '', true);
$$;

create function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true);
$$;

-- Tomorrow (UTC) at a given hour/minute.
create function pg_temp.at(days int, hhmm text) returns timestamptz language sql as $$
  select date_trunc('day', now()) + make_interval(days => days) + (hhmm || ':00')::time
$$;

create function pg_temp.open_tomorrow() returns int language sql as $$
  select count(*)::int from public.get_open_slots('acme', 3)
   where starts_at >= pg_temp.at(1, '00:00') and starts_at < pg_temp.at(2, '00:00')
$$;

-- Acme: owner, admin, member. Globex: owner.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'owner@acme.test',   '{"company_name": "Acme"}'),
  ('b0000000-0000-0000-0000-000000000001', 'owner@globex.test', '{"company_name": "Globex"}'),
  ('a0000000-0000-0000-0000-000000000002', 'admin@acme.test',   '{}'),
  ('a0000000-0000-0000-0000-000000000003', 'mia@acme.test',     '{}');
select set_config('test.acme', (select tenant_id::text from public.users where id = 'a0000000-0000-0000-0000-000000000001'), true);
delete from public.tenants where id in (select tenant_id from public.users where id in (
  'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003'));
insert into public.users (id, tenant_id, email, role) values
  ('a0000000-0000-0000-0000-000000000002', current_setting('test.acme')::uuid, 'admin@acme.test', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', current_setting('test.acme')::uuid, 'mia@acme.test',   'member');

select results_eq(
  $$ select slot_minutes::int, enabled, timezone from public.booking_settings
      where tenant_id = current_setting('test.acme')::uuid $$,
  $$ values (30, true, 'UTC') $$,
  'every new tenant gets default booking settings'
);

-- Deterministic availability: every day 09:00-11:00 UTC, 30-minute slots, no notice.
update public.booking_settings
   set days = '{1,2,3,4,5,6,7}', start_time = '09:00', end_time = '11:00',
       min_notice_hours = 0, horizon_days = 30
 where tenant_id = current_setting('test.acme')::uuid;

-- ---------------------------------------------------------------------------
-- A visitor with no account
-- ---------------------------------------------------------------------------
select pg_temp.visitor();

select results_eq(
  $$ select tenant_name, enabled from public.get_booking_page('acme') $$,
  $$ values ('Acme', true) $$,
  'a visitor can open a tenant''s booking page by slug'
);

select is_empty($$ select 1 from public.get_booking_page('no-such-tenant') $$, 'unknown slugs show nothing');

select is(pg_temp.open_tomorrow(), 4, 'tomorrow has four 30-minute slots between 09:00 and 11:00');

select lives_ok(
  $$ select set_config('test.token',
       (select cancel_token from public.book_appointment('acme', pg_temp.at(1, '09:00'), 'Vic Visitor', 'Vic@Example.test', 'Keen to see a demo')),
       true) $$,
  'a visitor can book an open slot'
);

select is(pg_temp.open_tomorrow(), 3, 'the booked slot is no longer offered');

select throws_ok(
  $$ select public.book_appointment('acme', pg_temp.at(1, '09:00'), 'Eve', 'eve@example.test') $$,
  'P0001', null,
  'a taken slot cannot be booked again'
);

select throws_ok(
  $$ select public.book_appointment('acme', pg_temp.at(1, '09:10'), 'Eve', 'eve@example.test') $$,
  'P0001', null,
  'only real slots can be booked (09:10 is not one)'
);

select throws_ok(
  $$ select 1 from public.appointments $$,
  '42501', null,
  'a visitor cannot read the appointments table'
);

select results_eq(
  $$ select name, status::text from public.get_booking(current_setting('test.token')) $$,
  $$ values ('Vic Visitor', 'booked') $$,
  'the cancel link shows the visitor their booking'
);

-- ---------------------------------------------------------------------------
-- Lead linking
-- ---------------------------------------------------------------------------
select pg_temp.logout();

select results_eq(
  $$ select l.source::text, l.email, l.last_engaged_at is not null, a.source::text, a.created_by is null
       from public.appointments a join public.leads l on l.id = a.lead_id
      where a.cancel_token = current_setting('test.token') $$,
  $$ values ('demo_request', 'vic@example.test', true, 'booking_page', true) $$,
  'a booking from a new email creates a lead, engaged now, and links to it'
);

insert into public.leads (tenant_id, name, email, source) values
  (current_setting('test.acme')::uuid, 'Kim Known', 'known@acme.test', 'referral');

select pg_temp.visitor();
select public.book_appointment('acme', pg_temp.at(1, '09:30'), 'Kim Known', 'KNOWN@acme.test');
select pg_temp.logout();

select results_eq(
  $$ select count(*)::int, bool_and(last_engaged_at is not null) from public.leads where email = 'known@acme.test' $$,
  $$ values (1, true) $$,
  'a booking from a known lead''s email reuses that lead and records the engagement'
);

select is(
  (select l.name from public.appointments a join public.leads l on l.id = a.lead_id
    where a.email = 'known@acme.test'),
  'Kim Known',
  'the appointment is linked to the existing lead'
);

-- ---------------------------------------------------------------------------
-- Per-email cap: at most 3 upcoming bookings
-- ---------------------------------------------------------------------------
select pg_temp.visitor();
select public.book_appointment('acme', pg_temp.at(1, '10:00'), 'Vic Visitor', 'vic@example.test');
select public.book_appointment('acme', pg_temp.at(1, '10:30'), 'Vic Visitor', 'vic@example.test');

select throws_ok(
  $$ select public.book_appointment('acme', pg_temp.at(2, '09:00'), 'Vic Visitor', 'vic@example.test') $$,
  'P0001', null,
  'one email cannot hold more than 3 upcoming bookings'
);

-- ---------------------------------------------------------------------------
-- Cancelling by token
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.cancel_booking(current_setting('test.token')) $$,
  'a visitor can cancel with their token'
);

select is(pg_temp.open_tomorrow(), 1, 'the cancelled slot is offered again');

select throws_ok(
  $$ select public.cancel_booking(current_setting('test.token')) $$,
  'P0001', null,
  'a booking cannot be cancelled twice'
);

select throws_ok(
  $$ select public.cancel_booking('not-a-real-token') $$,
  'P0001', null,
  'a made-up token cancels nothing'
);

-- ---------------------------------------------------------------------------
-- The team calendar
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000003'); -- mia, member

select is((select count(*)::int from public.appointments), 4, 'members see all of their tenant''s appointments');

select throws_ok(
  $$ select cancel_token from public.appointments $$,
  '42501', null,
  'members cannot read cancel tokens'
);

select lives_ok(
  $$ insert into public.appointments (starts_at, ends_at, name, email)
     values (pg_temp.at(2, '14:00'), pg_temp.at(2, '14:30'), 'Internal sync', 'client@acme.test') $$,
  'a member can book an appointment for the team'
);

select throws_ok(
  $$ insert into public.appointments (tenant_id, starts_at, ends_at, name, email)
     values (gen_random_uuid(), pg_temp.at(3, '14:00'), pg_temp.at(3, '14:30'), 'x', 'x@x.test') $$,
  '42501', null,
  'clients cannot choose an appointment''s tenant'
);

select pg_temp.login('a0000000-0000-0000-0000-000000000002'); -- admin

select throws_ok(
  $$ insert into public.appointments (starts_at, ends_at, name, email)
     values (pg_temp.at(2, '14:15'), pg_temp.at(2, '14:45'), 'Overlap', 'client@acme.test') $$,
  '23P01', null,
  'overlapping bookings are impossible (exclusion constraint)'
);

select pg_temp.login('a0000000-0000-0000-0000-000000000003'); -- mia, member

select is_empty(
  $$ update public.appointments set status = 'cancelled' where name = 'Vic Visitor' and status = 'booked' returning id $$,
  'a member cannot cancel someone else''s appointment'
);

select isnt_empty(
  $$ update public.appointments set notes = 'Agenda: pricing' where name = 'Internal sync' returning id $$,
  'a member can update an appointment they created'
);

select is_empty(
  $$ update public.booking_settings set headline = 'Members rule' returning tenant_id $$,
  'a member cannot change booking settings'
);

select pg_temp.login('a0000000-0000-0000-0000-000000000002'); -- admin

select isnt_empty(
  $$ update public.appointments set status = 'cancelled' where name = 'Vic Visitor' and status = 'booked' returning id $$,
  'an admin can cancel any appointment'
);

select throws_ok(
  $$ update public.booking_settings set timezone = 'Mars/Olympus_Mons' $$,
  '22023', null,
  'an unknown timezone is rejected'
);

select isnt_empty(
  $$ update public.booking_settings set enabled = false returning tenant_id $$,
  'an admin can turn the booking page off'
);

select pg_temp.visitor();

select is(pg_temp.open_tomorrow(), 0, 'a disabled booking page offers no slots');

select pg_temp.login('b0000000-0000-0000-0000-000000000001'); -- globex owner

select is_empty(
  $$ select 1 from public.appointments union all select 1 from public.booking_settings where tenant_id = current_setting('test.acme')::uuid $$,
  'another tenant sees none of Acme''s appointments or settings'
);

select * from finish();
rollback;
