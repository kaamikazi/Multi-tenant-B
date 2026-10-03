-- =============================================================================
-- Appointment occupancy, explicit status transitions, public-booking abuse
-- limits, narrower booking locks, and database-level text bounds.
--
-- 1. Occupied time. The no-overlap constraint covered only 'booked' rows, so
--    marking a future meeting 'completed' freed its slot for a double booking.
--    Now every appointment except a cancelled one occupies its interval.
--
-- 2. Status transitions, enforced for every writer:
--      booked    -> cancelled   any time
--      booked    -> completed   only once the meeting has started
--      cancelled -> anything    refused (book a new appointment instead)
--      completed -> anything    refused; its time can't be edited either
--    Notes may still be edited on any appointment.
--
-- 3. Public booking. The tenant-wide row lock is replaced by a transaction
--    advisory lock on (tenant, normalised email): that is exactly what the
--    "3 upcoming bookings per email" rule needs, and unrelated visitors no
--    longer queue behind each other. Slot races are settled by the exclusion
--    constraint, whose violation is turned into a friendly message. A
--    per-tenant cap of 50 booking-page bookings per 24 hours bounds spam and
--    the leads it can create (soft cap: under extreme concurrency it may be
--    exceeded by a few; the application rate limiter is the first line).
--
-- 4. Text bounds and email normalisation. Emails are capped at 254 chars
--    (RFC 5321) and stored lower-cased and trimmed. The app already compared
--    them case-insensitively (Supabase Auth lower-cases emails too); storage
--    now matches, so equality checks can't disagree.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Occupied time
-- ---------------------------------------------------------------------------
alter table public.appointments drop constraint appointments_no_double_booking;
alter table public.appointments add constraint appointments_no_double_booking exclude using gist (
  tenant_id with =,
  tstzrange(starts_at, ends_at) with &&
) where (status <> 'cancelled');

-- open_slots must treat completed meetings as occupied too.
create or replace function private.open_slots(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select slot.s, slot.s + make_interval(mins => b.slot_minutes)
    from public.booking_settings b
   cross join lateral generate_series(
           (greatest(p_from, now()) at time zone b.timezone)::date::timestamp,
           (least(p_to, now() + make_interval(days => b.horizon_days)) at time zone b.timezone)::date::timestamp,
           interval '1 day') as day
   cross join lateral generate_series(
           day + b.start_time,
           day + b.end_time - make_interval(mins => b.slot_minutes),
           make_interval(mins => b.slot_minutes)) as local_start
   cross join lateral (select local_start at time zone b.timezone as s) as slot
   where b.tenant_id = p_tenant
     and b.enabled
     and extract(isodow from day)::smallint = any (b.days)
     and slot.s >= greatest(p_from, now() + make_interval(hours => b.min_notice_hours))
     and slot.s <  least(p_to, now() + make_interval(days => b.horizon_days))
     and not exists (
       select 1 from public.appointments a
        where a.tenant_id = p_tenant
          and a.status <> 'cancelled'
          and tstzrange(a.starts_at, a.ends_at) && tstzrange(slot.s, slot.s + make_interval(mins => b.slot_minutes))
     )
   order by slot.s
$$;

revoke all on function private.open_slots(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Status transitions
-- ---------------------------------------------------------------------------
create function private.enforce_appointment_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('cancelled', 'completed')
     and (new.status is distinct from old.status
          or new.starts_at is distinct from old.starts_at
          or new.ends_at is distinct from old.ends_at
          or new.lead_id is distinct from old.lead_id) then
    raise exception 'A % appointment can''t be changed. Book a new one instead.', old.status
      using errcode = 'P0001';
  end if;

  if old.status = 'booked' and new.status = 'completed' and new.starts_at > now() then
    raise exception 'A meeting can only be marked done once it has started.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger appointments_enforce_transition
  before update on public.appointments
  for each row execute function private.enforce_appointment_transition();

-- ---------------------------------------------------------------------------
-- 4. Text bounds and email normalisation
-- ---------------------------------------------------------------------------
create function private.normalize_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.email is not null then
    new.email := lower(trim(new.email));
  end if;
  return new;
end;
$$;

create trigger invitations_normalize_email before insert or update of email on public.invitations
  for each row execute function private.normalize_email();
create trigger leads_normalize_email before insert or update of email on public.leads
  for each row execute function private.normalize_email();
create trigger appointments_normalize_email before insert or update of email on public.appointments
  for each row execute function private.normalize_email();

alter table public.users        add constraint users_email_length        check (char_length(email) <= 254);
alter table public.invitations  add constraint invitations_email_length  check (char_length(email) <= 254);
alter table public.leads        add constraint leads_email_length        check (email is null or char_length(email) <= 254);
alter table public.appointments add constraint appointments_email_length check (char_length(email) <= 254);

revoke all on function private.enforce_appointment_transition(), private.normalize_email() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Public booking
-- ---------------------------------------------------------------------------
create or replace function public.book_appointment(
  p_slug      text,
  p_starts_at timestamptz,
  p_name      text,
  p_email     text,
  p_notes     text default null
)
returns table (appointment_id uuid, cancel_token text, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant  uuid;
  v_slot    record;
  v_email   text := lower(trim(coalesce(p_email, '')));
  v_name    text := trim(coalesce(p_name, ''));
  v_notes   text := nullif(trim(coalesce(p_notes, '')), '');
  v_lead    uuid;
  v_appt    public.appointments;
begin
  -- Clear messages instead of raw constraint violations for public input.
  if char_length(v_name) not between 1 and 120 then
    raise exception 'Enter your name (up to 120 characters).' using errcode = '22023';
  end if;
  if char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_notes, '')) > 1000 then
    raise exception 'Keep notes under 1,000 characters.' using errcode = '22023';
  end if;

  select id into v_tenant from public.tenants where slug = p_slug;
  if v_tenant is null then
    raise exception 'This booking page does not exist.' using errcode = 'P0002';
  end if;

  -- Narrow lock: serialises only bookings by the same email in this tenant,
  -- which is what the per-email cap below needs.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || v_email, 0));

  select * into v_slot
    from private.open_slots(v_tenant, p_starts_at, p_starts_at + interval '1 second') s
   where s.starts_at = p_starts_at;
  if not found then
    raise exception 'That time is no longer available. Please pick another slot.' using errcode = 'P0001';
  end if;

  if (select count(*) from public.appointments a
       where a.tenant_id = v_tenant and a.email = v_email
         and a.status = 'booked' and a.starts_at > now()) >= 3 then
    raise exception 'You already have 3 upcoming bookings here. Cancel one to book another.' using errcode = 'P0001';
  end if;

  if (select count(*) from public.appointments a
       where a.tenant_id = v_tenant and a.source = 'booking_page'
         and a.created_at > now() - interval '24 hours') >= 50 then
    raise exception 'This booking page is receiving too many bookings right now. Please try again later.' using errcode = '54000';
  end if;

  select id into v_lead from public.leads
   where tenant_id = v_tenant and email = v_email
   order by created_at desc limit 1;

  if v_lead is null then
    insert into public.leads (tenant_id, name, email, source, status, notes, last_engaged_at, created_by)
    values (v_tenant, v_name, v_email, 'demo_request', 'new', 'Booked a meeting through the booking page.', now(), null)
    returning id into v_lead;
  else
    update public.leads set last_engaged_at = now() where id = v_lead;
  end if;

  begin
    insert into public.appointments (tenant_id, starts_at, ends_at, name, email, notes, source, lead_id, created_by)
    values (v_tenant, v_slot.starts_at, v_slot.ends_at, v_name, v_email, v_notes, 'booking_page', v_lead, null)
    returning * into v_appt;
  exception when exclusion_violation then
    -- Two visitors raced for the same slot; the constraint picked one.
    raise exception 'That time was just taken. Please pick another slot.' using errcode = 'P0001';
  end;

  return query select v_appt.id, v_appt.cancel_token, v_appt.starts_at, v_appt.ends_at;
end;
$$;

revoke all on function public.book_appointment(text, timestamptz, text, text, text) from public;
grant execute on function public.book_appointment(text, timestamptz, text, text, text) to anon, authenticated;
