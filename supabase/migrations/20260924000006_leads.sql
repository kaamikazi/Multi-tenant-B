-- =============================================================================
-- Leads + transparent lead scoring.
--
-- Scoring (0-100) lives in exactly one place, private.score_lead(), and is
-- exposed through the leads_scored view. The leads page, the lead detail
-- breakdown and the AI assistant all read that view, so they can't disagree.
--
--   Fit      max 40   budget (25) + company size (15)
--   Source   max 30   how well each lead source converts
--   Recency  max 30   days since the lead last engaged
--   Tiers    hot >= 70, warm >= 40, cold < 40
--
-- Access (on top of tenant isolation):
--   read / create      everyone in the tenant
--   edit               owners and admins: any lead; members: leads assigned to them
--   delete             owners and admins
-- =============================================================================

create type public.lead_source as enum (
  'referral', 'demo_request', 'webinar', 'organic_search',
  'paid_ads', 'social', 'cold_outreach', 'other'
);

create type public.lead_status as enum ('new', 'contacted', 'qualified', 'won', 'lost');

-- Lets leads reference "a user in this same tenant" with one composite key.
alter table public.users add constraint users_id_tenant_key unique (id, tenant_id);

create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default private.current_tenant_id()
                   references public.tenants (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 120),
  email            text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company          text check (char_length(company) <= 120),
  company_size     integer check (company_size is null or company_size between 1 and 1000000),
  budget_usd       integer check (budget_usd is null or budget_usd between 0 and 100000000),
  source           public.lead_source not null default 'other',
  status           public.lead_status not null default 'new',
  owner_id         uuid,
  notes            text check (char_length(notes) <= 4000),
  last_engaged_at  timestamptz,
  created_by       uuid default auth.uid() references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- The assignee must belong to the same tenant as the lead.
  foreign key (owner_id, tenant_id) references public.users (id, tenant_id) on delete set null (owner_id)
);

comment on table public.leads is 'Sales leads for a tenant. Scores come from the leads_scored view.';

create index leads_tenant_id_idx on public.leads (tenant_id);
create index leads_owner_idx on public.leads (owner_id);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function private.set_updated_at();

create trigger leads_prevent_tenant_id_change
  before update on public.leads
  for each row execute function private.prevent_tenant_id_change();

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------
create function private.score_lead(
  p_company_size    integer,
  p_budget_usd      integer,
  p_source          public.lead_source,
  p_last_engaged_at timestamptz
)
returns table (score integer, tier text, breakdown jsonb)
language sql
stable
set search_path = ''
as $$
  with parts as (
    select
      case
        when p_budget_usd is null     then 0
        when p_budget_usd >= 50000    then 25
        when p_budget_usd >= 20000    then 20
        when p_budget_usd >= 5000     then 12
        when p_budget_usd > 0         then 5
        else 0
      end as budget_pts,
      case
        when p_budget_usd is null then 'No budget recorded'
        else '$' || to_char(p_budget_usd, 'FM999,999,999') || ' budget'
      end as budget_reason,

      case
        when p_company_size is null   then 0
        when p_company_size >= 200    then 15
        when p_company_size >= 50     then 12
        when p_company_size >= 10     then 8
        else 3
      end as size_pts,
      case
        when p_company_size is null then 'Company size unknown'
        else to_char(p_company_size, 'FM999,999,999') || ' employees'
      end as size_reason,

      case p_source
        when 'referral'       then 30
        when 'demo_request'   then 28
        when 'webinar'        then 20
        when 'organic_search' then 18
        when 'paid_ads'       then 12
        when 'social'         then 10
        when 'cold_outreach'  then 6
        else 5
      end as source_pts,
      case p_source
        when 'referral'       then 'Referral (converts best)'
        when 'demo_request'   then 'Asked for a demo'
        when 'webinar'        then 'Attended a webinar'
        when 'organic_search' then 'Found us through search'
        when 'paid_ads'       then 'Came from a paid ad'
        when 'social'         then 'Came from social media'
        when 'cold_outreach'  then 'Cold outreach'
        else 'Other or unknown source'
      end as source_reason,

      floor(extract(epoch from (now() - p_last_engaged_at)) / 86400)::int as days
  ),
  recency as (
    select *,
      case
        when days is null  then 0
        when days <= 3     then 30
        when days <= 7     then 24
        when days <= 14    then 18
        when days <= 30    then 10
        when days <= 90    then 4
        else 0
      end as recency_pts,
      case
        when days is null  then 'Never engaged'
        when days <= 0     then 'Engaged today'
        when days = 1      then 'Engaged yesterday'
        else 'Engaged ' || days || ' days ago'
      end as recency_reason
    from parts
  )
  select
    budget_pts + size_pts + source_pts + recency_pts,
    case
      when budget_pts + size_pts + source_pts + recency_pts >= 70 then 'hot'
      when budget_pts + size_pts + source_pts + recency_pts >= 40 then 'warm'
      else 'cold'
    end,
    jsonb_build_array(
      jsonb_build_object('factor', 'Budget',       'points', budget_pts,  'max', 25, 'reason', budget_reason),
      jsonb_build_object('factor', 'Company size', 'points', size_pts,    'max', 15, 'reason', size_reason),
      jsonb_build_object('factor', 'Source',       'points', source_pts,  'max', 30, 'reason', source_reason),
      jsonb_build_object('factor', 'Recency',      'points', recency_pts, 'max', 30, 'reason', recency_reason)
    )
  from recency
$$;

revoke all on function private.score_lead(integer, integer, public.lead_source, timestamptz) from public, anon;
grant execute on function private.score_lead(integer, integer, public.lead_source, timestamptz) to authenticated;
-- Server-side code using the secret key (seeding, admin scripts) reads scores too.
grant usage on schema private to service_role;
grant execute on function private.score_lead(integer, integer, public.lead_source, timestamptz) to service_role;

-- security_invoker: the view runs with the caller's privileges, so the RLS
-- on public.leads still applies. Without it, a view bypasses RLS.
create view public.leads_scored
with (security_invoker = true)
as
select l.*, s.score, s.tier, s.breakdown
  from public.leads l
 cross join lateral private.score_lead(l.company_size, l.budget_usd, l.source, l.last_engaged_at) s;

comment on view public.leads_scored is 'Leads with their score, tier and per-factor breakdown.';

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
revoke all on public.leads, public.leads_scored from anon, authenticated;

grant select on public.leads, public.leads_scored to authenticated;
grant delete on public.leads to authenticated;
grant insert (name, email, company, company_size, budget_usd, source, status, owner_id, notes, last_engaged_at)
  on public.leads to authenticated;
grant update (name, email, company, company_size, budget_usd, source, status, owner_id, notes, last_engaged_at)
  on public.leads to authenticated;

alter table public.leads enable row level security;

create policy "everyone in the tenant can read leads"
  on public.leads for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "everyone in the tenant can add leads"
  on public.leads for insert
  to authenticated
  with check (tenant_id = (select private.current_tenant_id()));

create policy "owners and admins edit any lead, members edit their own"
  on public.leads for update
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and ((select private.has_role('owner', 'admin')) or owner_id = (select auth.uid()))
  )
  -- A member can't hand their lead to someone else.
  with check (
    tenant_id = (select private.current_tenant_id())
    and ((select private.has_role('owner', 'admin')) or owner_id = (select auth.uid()))
  );

create policy "owners and admins can delete leads"
  on public.leads for delete
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('owner', 'admin'))
  );
