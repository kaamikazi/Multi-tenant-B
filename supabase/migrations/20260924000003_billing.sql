-- =============================================================================
-- Billing: per-tenant plan + Stripe subscription state.
--
--   * tenants.plan is readable by every member (the app gates features on it)
--     but is not writable by any client: only the server, reacting to Stripe,
--     changes it (via the secret key, which bypasses RLS).
--   * public.billing holds Stripe ids and subscription status. Owners and
--     admins can read it; nobody can write it from the client.
--   * The Free plan's seat limit is enforced here, on invitation insert, so a
--     client that skips the UI still cannot exceed it.
-- =============================================================================

create type public.plan as enum ('free', 'pro');

alter table public.tenants add column plan public.plan not null default 'free';

-- The Phase 1 grant is `update (name)` only, so plan is already read-only for
-- clients. Nothing to change there; this comment is the reminder.

create table public.billing (
  tenant_id               uuid primary key references public.tenants (id) on delete cascade,
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  subscription_status     text,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  updated_at              timestamptz not null default now()
);

comment on table public.billing is
  'Stripe customer/subscription for a tenant. Written only by the server from Stripe data.';

create trigger billing_set_updated_at
  before update on public.billing
  for each row execute function private.set_updated_at();

create trigger billing_prevent_tenant_id_change
  before update on public.billing
  for each row execute function private.prevent_tenant_id_change();

revoke all on public.billing from anon, authenticated;
grant select on public.billing to authenticated;

alter table public.billing enable row level security;

create policy "owners and admins can see their tenant's billing"
  on public.billing for select
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('owner', 'admin'))
  );

-- ---------------------------------------------------------------------------
-- Seat limits
-- ---------------------------------------------------------------------------

-- null = unlimited. Keep in sync with PLANS in src/lib/billing.ts.
create function private.seat_limit(p_plan public.plan)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan when 'free' then 3 else null end
$$;

-- Seats in use = members + unexpired pending invitations.
create function private.seats_used(p_tenant uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.users where tenant_id = p_tenant)::int
       + (select count(*) from public.invitations
           where tenant_id = p_tenant and accepted_at is null and expires_at > now())::int
$$;

create function private.has_free_seat()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.seats_used(t.id) < private.seat_limit(t.plan)
       from public.tenants t
      where t.id = private.current_tenant_id()),
    false
  ) or exists (
    select 1 from public.tenants
     where id = private.current_tenant_id() and private.seat_limit(plan) is null
  )
$$;

-- Restrictive: ANDed with the role-based insert policy from the RBAC migration.
create policy "invitations need a free seat"
  on public.invitations as restrictive for insert
  to authenticated
  with check ((select private.has_free_seat()));

-- For the UI: "2 of 3 seats used". Counts only; scoped to the caller's tenant.
create function public.get_seat_usage()
returns table (used integer, seat_limit integer)
language sql
stable
security definer
set search_path = ''
as $$
  select private.seats_used(t.id), private.seat_limit(t.plan)
    from public.tenants t
   where t.id = private.current_tenant_id()
$$;

revoke all on function
  private.seat_limit(public.plan),
  private.seats_used(uuid),
  private.has_free_seat()
from public, anon;
grant execute on function
  private.seat_limit(public.plan),
  private.seats_used(uuid),
  private.has_free_seat()
to authenticated;

revoke all on function public.get_seat_usage() from public, anon;
grant execute on function public.get_seat_usage() to authenticated;
