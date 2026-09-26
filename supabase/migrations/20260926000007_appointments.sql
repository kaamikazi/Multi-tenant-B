-- =============================================================================
-- Appointments + a public booking page per tenant.
--
--   * booking_settings: one row per tenant (created with the tenant) with the
--     weekly availability window, slot length and timezone.
--   * appointments: an exclusion constraint makes double-booking impossible:
--     two 'booked' appointments in one tenant can never overlap, however they
--     are created (booking page, team, concurrent requests).
--   * Visitors without an account book through SECURITY DEFINER functions
--     keyed by the tenant's slug. They only ever see free slots, never who
--     booked, and cancel with a private token.
--   * A booking links to the lead with the same email (or creates one) and
--     counts as engagement, so it feeds the lead's recency score.
--
-- Access (on top of tenant isolation):
--   read appointments            everyone in the tenant (it's the team calendar)
--   create                       everyone in the tenant
--   edit / cancel                owners and admins: any; members: ones they
--                                created or whose lead is assigned to them
--   delete                       owners and admins
--   booking settings             read: everyone; edit: owners and admins
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

create type public.appointment_status as enum ('booked', 'cancelled', 'completed');
create type public.appointment_source as enum ('booking_page', 'team');

-- ---------------------------------------------------------------------------
-- Booking settings
-- ---------------------------------------------------------------------------
create table public.booking_settings (
  tenant_id         uuid primary key references public.tenants (id) on delete cascade,
  enabled           boolean not null default true,
  headline          text not null default 'Book a 30-minute intro call'
                    check (char_length(headline) between 1 and 120),
  timezone          text not null default 'UTC'
                    check ((now() at time zone timezone) is not null),
  days              smallint[] not null default '{1,2,3,4,5}'
                    check (days <@ '{1,2,3,4,5,6,7}' and cardinality(days) > 0), -- ISO weekdays, 1 = Monday
  start_time        time not null default '09:00',
  end_time          time not null default '17:00',
  slot_minutes      smallint not null default 30 check (slot_minutes in (15, 20, 30, 45, 60)),
  min_notice_hours  smallint not null default 12 check (min_notice_hours between 0 and 168),
  horizon_days      smallint not null default 21 check (horizon_days between 1 and 90),
  updated_at        timestamptz not null default now(),
  check (end_time > start_time)
);

comment on table public.booking_settings is 'When a tenant can be booked through its public booking page.';

create trigger booking_settings_set_updated_at
  before update on public.booking_settings
  for each row execute function private.set_updated_at();

create trigger booking_settings_prevent_tenant_id_change
  before update on public.booking_settings
  for each row execute function private.prevent_tenant_id_change();

-- Every tenant gets default settings, existing ones included.
create function private.create_booking_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.booking_settings (tenant_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger tenants_create_booking_settings
  after insert on public.tenants
  for each row execute function private.create_booking_settings();

insert into public.booking_settings (tenant_id) select id from public.tenants on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
-- Lets appointments reference "a lead in this same tenant" with one key.
alter table public.leads add constraint leads_id_tenant_key unique (id, tenant_id);

create table public.appointments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default private.current_tenant_id()
                references public.tenants (id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  name          text not null check (char_length(name) between 1 and 120),
  email         text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes         text check (char_length(notes) <= 1000),
  status        public.appointment_status not null default 'booked',
  source        public.appointment_source not null default 'team',
  lead_id       uuid,
  created_by    uuid default auth.uid() references public.users (id) on delete set null,
  -- Lets a visitor cancel their own booking. Never readable by clients.
  cancel_token  text not null unique
                default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '8 hours'),
  foreign key (lead_id, tenant_id) references public.leads (id, tenant_id) on delete set null (lead_id),
  -- No two live bookings in a tenant may overlap.
  constraint appointments_no_double_booking exclude using gist (
    tenant_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'booked')
);

comment on table public.appointments is 'Meetings for a tenant, booked by the team or through the public booking page.';

create index appointments_tenant_start_idx on public.appointments (tenant_id, starts_at);
create index appointments_lead_idx on public.appointments (lead_id);

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function private.set_updated_at();

create trigger appointments_prevent_tenant_id_change
  before update on public.appointments
  for each row execute function private.prevent_tenant_id_change();

-- ---------------------------------------------------------------------------
-- Slot generation (the one place availability is computed)
-- ---------------------------------------------------------------------------
create function private.open_slots(p_tenant uuid, p_from timestamptz, p_to timestamptz)
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
          and a.status = 'booked'
          and tstzrange(a.starts_at, a.ends_at) && tstzrange(slot.s, slot.s + make_interval(mins => b.slot_minutes))
     )
   order by slot.s
$$;

-- ---------------------------------------------------------------------------
-- Public booking API (callable without an account)
-- ---------------------------------------------------------------------------
create function public.get_booking_page(p_slug text)
returns table (tenant_name text, headline text, timezone text, slot_minutes smallint, enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.name, b.headline, b.timezone, b.slot_minutes, b.enabled
    from public.tenants t
    join public.booking_settings b on b.tenant_id = t.id
   where t.slug = p_slug
$$;

create function public.get_open_slots(p_slug text, p_days integer default 14)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.starts_at, s.ends_at
    from public.tenants t
   cross join lateral private.open_slots(t.id, now(), now() + make_interval(days => least(greatest(p_days, 1), 90))) s
   where t.slug = p_slug
$$;

create function public.book_appointment(
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
  v_email   text := lower(trim(p_email));
  v_name    text := trim(p_name);
  v_lead    uuid;
  v_appt    public.appointments;
begin
  select id into v_tenant from public.tenants where slug = p_slug;
  if v_tenant is null then
    raise exception 'This booking page does not exist.' using errcode = 'P0002';
  end if;

  -- Serialise bookings per tenant so the checks below see each other.
  perform 1 from public.booking_settings where tenant_id = v_tenant for update;

  select * into v_slot
    from private.open_slots(v_tenant, p_starts_at, p_starts_at + interval '1 second') s
   where s.starts_at = p_starts_at;
  if not found then
    raise exception 'That time is no longer available. Please pick another slot.' using errcode = 'P0001';
  end if;

  if (select count(*) from public.appointments a
       where a.tenant_id = v_tenant and lower(a.email) = v_email
         and a.status = 'booked' and a.starts_at > now()) >= 3 then
    raise exception 'You already have 3 upcoming bookings here. Cancel one to book another.' using errcode = 'P0001';
  end if;

  -- Link to the lead with this email, or create one; either way the booking
  -- counts as engagement and refreshes the lead's recency score.
  select id into v_lead from public.leads
   where tenant_id = v_tenant and lower(email) = v_email
   order by created_at desc limit 1;

  if v_lead is null then
    insert into public.leads (tenant_id, name, email, source, status, notes, last_engaged_at, created_by)
    values (v_tenant, v_name, v_email, 'demo_request', 'new', 'Booked a meeting through the booking page.', now(), null)
    returning id into v_lead;
  else
    update public.leads set last_engaged_at = now() where id = v_lead;
  end if;

  insert into public.appointments (tenant_id, starts_at, ends_at, name, email, notes, source, lead_id, created_by)
  values (v_tenant, v_slot.starts_at, v_slot.ends_at, v_name, v_email, nullif(trim(p_notes), ''), 'booking_page', v_lead, null)
  returning * into v_appt;

  return query select v_appt.id, v_appt.cancel_token, v_appt.starts_at, v_appt.ends_at;
end;
$$;

create function public.get_booking(p_token text)
returns table (tenant_name text, tenant_slug text, timezone text, name text, starts_at timestamptz, ends_at timestamptz, status public.appointment_status)
language sql
stable
security definer
set search_path = ''
as $$
  select t.name, t.slug, b.timezone, a.name, a.starts_at, a.ends_at, a.status
    from public.appointments a
    join public.tenants t on t.id = a.tenant_id
    join public.booking_settings b on b.tenant_id = a.tenant_id
   where a.cancel_token = p_token
$$;

create function public.cancel_booking(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.appointments
     set status = 'cancelled'
   where cancel_token = p_token and status = 'booked' and starts_at > now();
  if not found then
    raise exception 'This booking can no longer be cancelled.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function
  public.get_booking_page(text),
  public.get_open_slots(text, integer),
  public.book_appointment(text, timestamptz, text, text, text),
  public.get_booking(text),
  public.cancel_booking(text)
from public;
grant execute on function
  public.get_booking_page(text),
  public.get_open_slots(text, integer),
  public.book_appointment(text, timestamptz, text, text, text),
  public.get_booking(text),
  public.cancel_booking(text)
to anon, authenticated;

revoke all on function private.open_slots(uuid, timestamptz, timestamptz), private.create_booking_settings()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
revoke all on public.booking_settings, public.appointments from anon, authenticated;

grant select on public.booking_settings to authenticated;
grant update (enabled, headline, timezone, days, start_time, end_time, slot_minutes, min_notice_hours, horizon_days)
  on public.booking_settings to authenticated;

-- Every column except cancel_token.
grant select (id, tenant_id, starts_at, ends_at, name, email, notes, status, source, lead_id, created_by, created_at, updated_at)
  on public.appointments to authenticated;
grant insert (starts_at, ends_at, name, email, notes, lead_id) on public.appointments to authenticated;
grant update (starts_at, ends_at, name, email, notes, status, lead_id) on public.appointments to authenticated;
grant delete on public.appointments to authenticated;

alter table public.booking_settings enable row level security;
alter table public.appointments enable row level security;

create policy "everyone in the tenant can read booking settings"
  on public.booking_settings for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "owners and admins edit booking settings"
  on public.booking_settings for update
  to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('owner', 'admin')))
  with check (tenant_id = (select private.current_tenant_id()));

create policy "everyone in the tenant can read appointments"
  on public.appointments for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "everyone in the tenant can add appointments"
  on public.appointments for insert
  to authenticated
  with check (tenant_id = (select private.current_tenant_id()));

create policy "owners and admins edit any appointment, members their own"
  on public.appointments for update
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (
      (select private.has_role('owner', 'admin'))
      or created_by = (select auth.uid())
      or exists (select 1 from public.leads l where l.id = lead_id and l.owner_id = (select auth.uid()))
    )
  )
  with check (tenant_id = (select private.current_tenant_id()));

create policy "owners and admins can delete appointments"
  on public.appointments for delete
  to authenticated
  using (tenant_id = (select private.current_tenant_id()) and (select private.has_role('owner', 'admin')));
