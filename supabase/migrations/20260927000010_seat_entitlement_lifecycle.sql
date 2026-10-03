-- =============================================================================
-- Seat limits hold through the whole plan lifecycle, not only at invite time.
--
-- Problem fixed: seats were checked when an invitation was created, but not
-- when it was accepted. A Pro workspace could create many invitations,
-- downgrade to Free, and still have every one of them accepted, ending far
-- above the Free limit.
--
-- Downgrade model (nothing is deleted):
--   * Existing members stay. A Free workspace can end up with more members
--     than Free allows; get_seat_usage() then reports over_limit = true and
--     the UI explains it.
--   * While at or over the limit, the workspace can't add anyone: new
--     invitations are refused (existing trigger) and so are acceptances of
--     invitations created earlier, e.g. while on Pro (this migration).
--   * Acceptance checks the *current* plan and member count inside the same
--     transaction, holding a lock on the tenant row, so two people accepting
--     at the same moment can't both take the last seat.
--   * Pro stays unlimited. Role rules are unchanged.
-- =============================================================================

create or replace function private.join_via_invitation(
  p_user_id   uuid,
  p_email     text,
  p_token     text,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv      public.invitations;
  seat_cap integer;
  members  integer;
begin
  select * into inv from public.invitations where token = p_token for update;

  if not found or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'This invitation is invalid or has expired.' using errcode = 'P0001';
  end if;

  if lower(inv.email) <> lower(p_email) then
    raise exception 'This invitation was sent to a different email address.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.users where id = p_user_id) then
    raise exception 'This account already belongs to a workspace.' using errcode = 'P0001';
  end if;

  -- Authoritative seat check against the plan as it is *now*. The row lock
  -- serialises concurrent acceptances (and invitations) for this tenant.
  select private.seat_limit(plan) into seat_cap
    from public.tenants where id = inv.tenant_id
     for update;
  select count(*)::int into members from public.users where tenant_id = inv.tenant_id;

  if seat_cap is not null and members >= seat_cap then
    raise exception 'This workspace has no free seats on its current plan. Ask the owner to upgrade or free a seat.'
      using errcode = '54000';
  end if;

  insert into public.users (id, tenant_id, email, full_name, role)
  values (p_user_id, inv.tenant_id, p_email, nullif(trim(p_full_name), ''), inv.role);

  update public.invitations
     set accepted_at = now(), accepted_by = p_user_id
   where id = inv.id;

  return inv.tenant_id;
end;
$$;

revoke all on function private.join_via_invitation(uuid, text, text, text) from public, anon, authenticated;

-- The invite page can say "no free seats" up front instead of failing on sign-up.
drop function public.get_invitation(text);
create function public.get_invitation(p_token text)
returns table (tenant_name text, email text, role public.tenant_role, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.name,
         i.email,
         i.role,
         case
           when i.accepted_at is not null then 'accepted'
           when i.expires_at < now()      then 'expired'
           when private.seat_limit(t.plan) is not null
            and (select count(*) from public.users u where u.tenant_id = t.id) >= private.seat_limit(t.plan)
                                           then 'no_seats'
           else 'valid'
         end
    from public.invitations i
    join public.tenants t on t.id = i.tenant_id
   where i.token = p_token
$$;

revoke all on function public.get_invitation(text) from public;
grant execute on function public.get_invitation(text) to anon, authenticated;

-- Seat usage now also reports members and whether the workspace is over its plan.
drop function public.get_seat_usage();
create function public.get_seat_usage()
returns table (used integer, seat_limit integer, members integer, over_limit boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select private.seats_used(t.id),
         private.seat_limit(t.plan),
         (select count(*)::int from public.users u where u.tenant_id = t.id),
         coalesce((select count(*) from public.users u where u.tenant_id = t.id) > private.seat_limit(t.plan), false)
    from public.tenants t
   where t.id = private.current_tenant_id()
$$;

revoke all on function public.get_seat_usage() from public, anon;
grant execute on function public.get_seat_usage() to authenticated;
