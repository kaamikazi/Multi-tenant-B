-- Appointment occupancy, status transitions, public-booking limits, text bounds.
begin;
select plan(23);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.visitor() returns void language sql as $$
  select set_config('role', 'anon', true), set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.at(days int, hhmm text) returns timestamptz language sql as $$
  select date_trunc('day', now()) + make_interval(days => days) + (hhmm || ':00')::time
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'owner@acme.test', '{"company_name": "Acme"}'),
  ('a0000000-0000-0000-0000-000000000003', 'mia@acme.test',   '{}');
select set_config('test.acme', (select tenant_id::text from public.users where id = 'a0000000-0000-0000-0000-000000000001'), true);
delete from public.tenants where id = (select tenant_id from public.users where id = 'a0000000-0000-0000-0000-000000000003');
insert into public.users (id, tenant_id, email, role) values
  ('a0000000-0000-0000-0000-000000000003', current_setting('test.acme')::uuid, 'mia@acme.test', 'member');
update public.booking_settings
   set days = '{1,2,3,4,5,6,7}', start_time = '09:00', end_time = '17:00', min_notice_hours = 0, horizon_days = 30
 where tenant_id = current_setting('test.acme')::uuid;

-- A past meeting Mia booked, still marked booked.
insert into public.appointments (tenant_id, starts_at, ends_at, name, email, created_by)
values (current_setting('test.acme')::uuid, pg_temp.at(-1, '10:00'), pg_temp.at(-1, '11:00'), 'Past sync', 'client@acme.test',
        'a0000000-0000-0000-0000-000000000003');

-- ---------------------------------------------------------------------------
-- Status transitions
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000003'); -- mia
insert into public.appointments (starts_at, ends_at, name, email)
values (pg_temp.at(2, '14:00'), pg_temp.at(2, '14:30'), 'Future call', 'client@acme.test');

select throws_like(
  $$ update public.appointments set status = 'completed' where name = 'Future call' $$,
  '%once it has started%', 'a future meeting cannot be marked done');

select lives_ok(
  $$ update public.appointments set status = 'completed' where name = 'Past sync' $$,
  'a meeting that has started can be marked done');

select throws_like(
  $$ update public.appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where name = 'Past sync' $$,
  '%completed appointment can''t be changed%', 'a completed meeting cannot be re-timed');

select throws_like(
  $$ update public.appointments set status = 'booked' where name = 'Past sync' $$,
  '%completed appointment can''t be changed%', 'a completed meeting cannot be reopened');

select lives_ok(
  $$ update public.appointments set notes = 'Went well' where name = 'Past sync' $$,
  'notes on a completed meeting can still be edited');

-- ---------------------------------------------------------------------------
-- Occupied time
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.appointments (starts_at, ends_at, name, email)
     values (pg_temp.at(-1, '10:30'), pg_temp.at(-1, '11:30'), 'Overlap with completed', 'x@acme.test') $$,
  '23P01', null, 'a completed meeting still occupies its time');

select lives_ok(
  $$ update public.appointments set status = 'cancelled' where name = 'Future call' $$,
  'a booked meeting can be cancelled');

select throws_like(
  $$ update public.appointments set status = 'booked' where name = 'Future call' $$,
  '%cancelled appointment can''t be changed%', 'a cancelled meeting cannot be revived (its slot may be taken)');

select lives_ok(
  $$ insert into public.appointments (starts_at, ends_at, name, email)
     values (pg_temp.at(2, '14:00'), pg_temp.at(2, '14:30'), 'Rebooked call', 'client@acme.test') $$,
  'a cancelled meeting frees its time');

-- Marking a future meeting done must not free its slot any more (the old bug).
select pg_temp.logout();
select is(
  (select count(*)::int from public.get_open_slots('acme', 3) where starts_at = pg_temp.at(2, '14:00')),
  0, 'the public page does not offer an occupied slot');

-- ---------------------------------------------------------------------------
-- Public booking: input bounds (clear errors, not raw constraint failures)
-- ---------------------------------------------------------------------------
select pg_temp.visitor();

select throws_like($$ select public.book_appointment('acme', pg_temp.at(3, '09:00'), repeat('n', 121), 'a@b.test') $$,
  '%up to 120 characters%', 'an oversized name is rejected');
select throws_like($$ select public.book_appointment('acme', pg_temp.at(3, '09:00'), 'Ann', repeat('e', 250) || '@b.test') $$,
  '%valid email%', 'an oversized email is rejected');
select throws_like($$ select public.book_appointment('acme', pg_temp.at(3, '09:00'), 'Ann', 'not-an-email') $$,
  '%valid email%', 'a malformed email is rejected');
select throws_like($$ select public.book_appointment('acme', pg_temp.at(3, '09:00'), 'Ann', 'a@b.test', repeat('x', 1001)) $$,
  '%under 1,000%', 'oversized notes are rejected');
select throws_like($$ select public.book_appointment('acme', pg_temp.at(3, '09:00'), '   ', 'a@b.test') $$,
  '%Enter your name%', 'a blank name is rejected');

-- ---------------------------------------------------------------------------
-- Email normalisation and the per-email cap
-- ---------------------------------------------------------------------------
select public.book_appointment('acme', pg_temp.at(3, '09:00'), 'Vic', '  Vic@Example.TEST ');
select pg_temp.logout();
select is((select email from public.appointments where name = 'Vic'), 'vic@example.test', 'booking emails are stored normalised');
select is((select email from public.leads where name = 'Vic'), 'vic@example.test', 'the lead created from a booking is normalised too');

select pg_temp.visitor();
select public.book_appointment('acme', pg_temp.at(3, '09:30'), 'Vic', 'VIC@example.test');
select public.book_appointment('acme', pg_temp.at(3, '10:00'), 'Vic', 'vic@EXAMPLE.test');
select throws_like(
  $$ select public.book_appointment('acme', pg_temp.at(3, '10:30'), 'Vic', 'Vic@Example.Test') $$,
  '%3 upcoming bookings%', 'changing the letter case of an email does not bypass the 3-booking cap');

select pg_temp.logout();
select is((select count(*)::int from public.leads where email = 'vic@example.test'), 1,
  'repeat bookings reuse one lead rather than creating junk leads');

-- ---------------------------------------------------------------------------
-- Per-tenant daily cap on public bookings (bounds spam and junk leads)
-- ---------------------------------------------------------------------------
insert into public.appointments (tenant_id, starts_at, ends_at, name, email, source)
select current_setting('test.acme')::uuid, pg_temp.at(20, '00:00') + make_interval(hours => n), pg_temp.at(20, '00:30') + make_interval(hours => n),
       'Spam ' || n, 'spam' || n || '@x.test', 'booking_page'
  from generate_series(1, 47) n;
select pg_temp.visitor();
select throws_ok(
  $$ select public.book_appointment('acme', pg_temp.at(4, '09:00'), 'One more', 'late@x.test') $$,
  '54000', null, 'after 50 public bookings in 24 hours the page stops accepting more');

-- ---------------------------------------------------------------------------
-- Text bounds on team-side writes
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000001'); -- owner
select throws_ok(
  $$ insert into public.leads (name, email) values ('Big', repeat('e', 250) || '@b.test') $$,
  '23514', null, 'lead emails are capped at 254 characters');
select throws_ok(
  $$ insert into public.invitations (email, role) values (repeat('e', 250) || '@b.test', 'member') $$,
  '23514', null, 'invitation emails are capped at 254 characters');
insert into public.invitations (email, role) values ('  New.Person@Acme.TEST ', 'member');
select is((select email from public.invitations where email like 'new.person%'), 'new.person@acme.test',
  'invitation emails are stored normalised');

select * from finish();
rollback;
