-- =============================================================================
-- Bounded, aggregated queries for the AI assistant's tools.
--
-- Before: several tools read whole tables into Node (every scored lead to
-- count tiers, every user or lead just to resolve names). Cost grew with the
-- tenant and the model could be handed unbounded data.
--
-- After: aggregation and joins happen in Postgres and every collection has a
-- hard row limit. All functions are SECURITY INVOKER (the default), so they
-- run as the signed-in user and RLS still decides what they can see. They
-- are not a way around RLS, only a cheaper way through it.
-- =============================================================================

create index if not exists leads_tenant_status_idx on public.leads (tenant_id, status);

-- Team size by role.
create function public.ai_team_overview()
returns table (team_size integer, owners integer, admins integer, members integer)
language sql
stable
set search_path = ''
as $$
  select count(*)::int,
         count(*) filter (where role = 'owner')::int,
         count(*) filter (where role = 'admin')::int,
         count(*) filter (where role = 'member')::int
    from public.users
$$;

-- Pipeline counts without shipping rows to the application.
create function public.ai_pipeline_summary()
returns table (
  total_leads integer, open_leads integer,
  open_hot integer, open_warm integer, open_cold integer,
  unassigned_open integer, average_open_score integer,
  won integer, lost integer
)
language sql
stable
set search_path = ''
as $$
  select count(*)::int,
         count(*) filter (where status in ('new', 'contacted', 'qualified'))::int,
         count(*) filter (where status in ('new', 'contacted', 'qualified') and tier = 'hot')::int,
         count(*) filter (where status in ('new', 'contacted', 'qualified') and tier = 'warm')::int,
         count(*) filter (where status in ('new', 'contacted', 'qualified') and tier = 'cold')::int,
         count(*) filter (where status in ('new', 'contacted', 'qualified') and owner_id is null)::int,
         round(avg(score) filter (where status in ('new', 'contacted', 'qualified')))::int,
         count(*) filter (where status = 'won')::int,
         count(*) filter (where status = 'lost')::int
    from public.leads_scored
$$;

-- Ranked leads with the owner's name resolved in the same query.
create function public.ai_list_leads(
  p_tier     text default null,
  p_status   text default 'open',
  p_mine     boolean default false,
  p_limit    integer default 10
)
returns table (
  name text, company text, score integer, tier text, status public.lead_status,
  source public.lead_source, owner_name text, owner_is_me boolean,
  last_engaged_at timestamptz, breakdown jsonb
)
language sql
stable
set search_path = ''
as $$
  select l.name, l.company, l.score, l.tier, l.status, l.source,
         coalesce(u.full_name, u.email), l.owner_id = (select auth.uid()),
         l.last_engaged_at, l.breakdown
    from public.leads_scored l
    left join public.users u on u.id = l.owner_id
   where (p_tier is null or l.tier = p_tier)
     and case coalesce(p_status, 'open')
           when 'open' then l.status in ('new', 'contacted', 'qualified')
           when 'all'  then true
           else l.status::text = p_status
         end
     and (not coalesce(p_mine, false) or l.owner_id = (select auth.uid()))
   order by l.score desc, l.last_engaged_at desc nulls last
   limit least(greatest(coalesce(p_limit, 10), 1), 25)
$$;

-- Appointments in a window, with the linked lead's name and owner resolved.
create function public.ai_list_appointments(
  p_from              timestamptz,
  p_to                timestamptz,
  p_include_cancelled boolean default false,
  p_mine              boolean default false,
  p_limit             integer default 25
)
returns table (
  starts_at timestamptz, ends_at timestamptz, name text,
  status public.appointment_status, source public.appointment_source, lead_name text
)
language sql
stable
set search_path = ''
as $$
  select a.starts_at, a.ends_at, a.name, a.status, a.source, l.name
    from public.appointments a
    left join public.leads l on l.id = a.lead_id
   where a.starts_at >= p_from
     and a.starts_at < least(p_to, p_from + interval '93 days')
     and (coalesce(p_include_cancelled, false) or a.status <> 'cancelled')
     and (not coalesce(p_mine, false)
          or a.created_by = (select auth.uid())
          or l.owner_id = (select auth.uid()))
   order by a.starts_at
   limit least(greatest(coalesce(p_limit, 25), 1), 50)
$$;

revoke all on function
  public.ai_team_overview(),
  public.ai_pipeline_summary(),
  public.ai_list_leads(text, text, boolean, integer),
  public.ai_list_appointments(timestamptz, timestamptz, boolean, boolean, integer)
from public, anon;
grant execute on function
  public.ai_team_overview(),
  public.ai_pipeline_summary(),
  public.ai_list_leads(text, text, boolean, integer),
  public.ai_list_appointments(timestamptz, timestamptz, boolean, boolean, integer)
to authenticated;
