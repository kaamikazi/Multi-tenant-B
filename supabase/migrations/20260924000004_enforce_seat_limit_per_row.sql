-- =============================================================================
-- Fix: the Free-plan seat limit could be bypassed with one bulk insert.
--
-- The restrictive policy from the billing migration called a STABLE function
-- wrapped in (select ...), which Postgres evaluates once per statement. A
-- single `insert ... values (...), (...), ...` of ten invitations therefore
-- saw "1 seat used" for every row and created all ten.
--
-- Enforce the limit in a BEFORE INSERT row trigger instead. The trigger is
-- volatile, so each row sees the rows inserted before it in the same statement,
-- and it locks the tenant row so concurrent requests are counted one at a time.
-- =============================================================================

drop policy "invitations need a free seat" on public.invitations;

create function private.enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  seat_cap integer;
begin
  -- BEFORE triggers run ahead of RLS. If the caller may not send this invite
  -- at all, step aside so RLS reports "not allowed" rather than "seats full".
  -- (Server-side inserts with no session also land here and are trusted.)
  if not (private.has_role('owner') or (private.has_role('admin') and new.role = 'member')) then
    return new;
  end if;

  -- Serialises seat checks per tenant (concurrent invites wait their turn).
  select private.seat_limit(plan) into seat_cap
    from public.tenants where id = new.tenant_id
     for update;

  if seat_cap is not null and private.seats_used(new.tenant_id) >= seat_cap then
    raise exception 'All % seats on the Free plan are in use.', seat_cap
      using errcode = '54000'; -- program_limit_exceeded
  end if;
  return new;
end;
$$;

create trigger invitations_enforce_seat_limit
  before insert on public.invitations
  for each row
  -- Rows the server inserts for another tenant's fixtures still get checked;
  -- expired invitations don't hold a seat, so they skip the check.
  when (new.accepted_at is null and new.expires_at > now())
  execute function private.enforce_seat_limit();

revoke all on function private.enforce_seat_limit() from public, anon, authenticated;

-- has_free_seat() is no longer used by any policy.
drop function private.has_free_seat();
