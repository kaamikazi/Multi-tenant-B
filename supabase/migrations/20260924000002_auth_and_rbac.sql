-- =============================================================================
-- Auth + RBAC: sign-up provisioning, invitations, member management.
--
-- Role rules (enforced here; the UI mirrors them from src/lib/rbac.ts)
--
--   action                         owner   admin            member
--   ------------------------------ ------- ---------------- ------
--   invite a member                  yes    yes              no
--   invite an admin                  yes    no               no
--   revoke a pending invitation      yes    member invites   no
--   remove a member                  yes    yes              no
--   remove an admin                  yes    no               no
--   promote / demote (member/admin)  yes    no               no
--   transfer ownership               yes    no               no
--   rename workspace                 yes    no               no
--
-- Nobody can remove themselves, change their own role, or remove the owner.
--
-- Where the rule is about *which rows* a role may touch (invitations,
-- removals) it is an RLS policy. Where it is about *which value* a column may
-- take (role changes), it is a SECURITY DEFINER function, because Postgres
-- policies cannot restrict individual columns.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default private.current_tenant_id()
               references public.tenants (id) on delete cascade,
  email        text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role         public.tenant_role not null check (role <> 'owner'),
  -- 244 bits of randomness; the token is the only secret in an invite link.
  token        text not null unique
               default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by   uuid default auth.uid() references public.users (id) on delete set null,
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.invitations is
  'Pending and accepted invitations to join a tenant. Accepted via invite link.';

create index invitations_tenant_id_idx on public.invitations (tenant_id);
create unique index invitations_one_pending_per_email
  on public.invitations (tenant_id, lower(email)) where accepted_at is null;

create trigger invitations_prevent_tenant_id_change
  before update on public.invitations
  for each row execute function private.prevent_tenant_id_change();

revoke all on public.invitations from anon, authenticated;
grant select, delete on public.invitations to authenticated;
-- Clients choose only who and what role; tenant, token, inviter and expiry
-- come from column defaults evaluated on the server.
grant insert (email, role) on public.invitations to authenticated;

alter table public.invitations enable row level security;

create policy "owners and admins can see their tenant's invitations"
  on public.invitations for select
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('owner', 'admin'))
  );

create policy "owners invite anyone, admins invite members"
  on public.invitations for insert
  to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and (
      (select private.has_role('owner'))
      or ((select private.has_role('admin')) and role = 'member')
    )
  );

create policy "owners revoke any invite, admins revoke member invites"
  on public.invitations for delete
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and accepted_at is null
    and (
      (select private.has_role('owner'))
      or ((select private.has_role('admin')) and role = 'member')
    )
  );

-- ---------------------------------------------------------------------------
-- Removing users
-- ---------------------------------------------------------------------------
grant delete on public.users to authenticated;

create policy "owners remove anyone, admins remove members"
  on public.users for delete
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and id <> (select auth.uid())
    and role <> 'owner'
    and (
      (select private.has_role('owner'))
      or ((select private.has_role('admin')) and role = 'member')
    )
  );

-- ---------------------------------------------------------------------------
-- Joining a tenant through an invitation (shared by sign-up and by existing
-- accounts that have no tenant, e.g. someone who was removed and re-invited)
-- ---------------------------------------------------------------------------
create function private.join_via_invitation(
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
  inv public.invitations;
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

  insert into public.users (id, tenant_id, email, full_name, role)
  values (p_user_id, inv.tenant_id, p_email, nullif(trim(p_full_name), ''), inv.role);

  update public.invitations
     set accepted_at = now(), accepted_by = p_user_id
   where id = inv.id;

  return inv.tenant_id;
end;
$$;

-- Turns a company name into a unique slug: "Acme, Inc." -> "acme-inc" (or
-- "acme-inc-3f9a1c" when taken).
create function private.unique_tenant_slug(p_name text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  base text;
  candidate text;
begin
  base := trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'));
  base := trim(both '-' from left(base, 40));
  if char_length(base) < 3 then
    base := 'workspace';
  end if;

  candidate := base;
  while exists (select 1 from public.tenants where slug = candidate) loop
    candidate := base || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
  end loop;
  return candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sign-up provisioning: every new auth user either joins the tenant their
-- invite token points at, or gets a brand-new tenant and becomes its owner.
-- Runs in the same transaction as the auth.users insert, so a user can never
-- end up half-provisioned.
-- ---------------------------------------------------------------------------
create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta         jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  company_name text  := nullif(trim(meta ->> 'company_name'), '');
  new_tenant   uuid;
begin
  if meta ? 'invite_token' then
    perform private.join_via_invitation(new.id, new.email, meta ->> 'invite_token', meta ->> 'full_name');
    return new;
  end if;

  company_name := coalesce(company_name, split_part(new.email, '@', 1) || '''s workspace');

  insert into public.tenants (name, slug)
  values (left(company_name, 100), private.unique_tenant_slug(company_name))
  returning id into new_tenant;

  insert into public.users (id, tenant_id, email, full_name, role)
  values (new.id, new_tenant, new.email, nullif(trim(meta ->> 'full_name'), ''), 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

-- Lets the invite page show "Join Acme as a member" before the visitor has an
-- account. Only reveals anything to someone who already holds the token.
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
           else 'valid'
         end
    from public.invitations i
    join public.tenants t on t.id = i.tenant_id
   where i.token = p_token
$$;

-- For a signed-in account that has no tenant yet.
create function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_email text;
begin
  select email into caller_email from auth.users where id = (select auth.uid());
  if caller_email is null then
    raise exception 'You must be signed in to accept an invitation.' using errcode = '42501';
  end if;
  return private.join_via_invitation((select auth.uid()), caller_email, p_token);
end;
$$;

create function public.set_member_role(p_user_id uuid, p_role public.tenant_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.tenant_role;
begin
  if not private.has_role('owner') then
    raise exception 'Only the workspace owner can change roles.' using errcode = '42501';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot change your own role.' using errcode = 'P0001';
  end if;

  if p_role = 'owner' then
    raise exception 'Use ownership transfer to make someone the owner.' using errcode = 'P0001';
  end if;

  select role into target_role
    from public.users
   where id = p_user_id and tenant_id = private.current_tenant_id();

  if not found then
    raise exception 'That user is not in your workspace.' using errcode = 'P0002';
  end if;

  update public.users set role = p_role where id = p_user_id;
end;
$$;

create function public.transfer_ownership(p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if not private.has_role('owner') then
    raise exception 'Only the workspace owner can transfer ownership.' using errcode = '42501';
  end if;

  if p_new_owner = caller then
    raise exception 'You already own this workspace.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.users
     where id = p_new_owner and tenant_id = private.current_tenant_id()
  ) then
    raise exception 'That user is not in your workspace.' using errcode = 'P0002';
  end if;

  -- Demote first: the one-owner-per-tenant index forbids two owners at once.
  update public.users set role = 'admin' where id = caller;
  update public.users set role = 'owner' where id = p_new_owner;
end;
$$;

revoke all on function
  public.get_invitation(text),
  public.accept_invitation(text),
  public.set_member_role(uuid, public.tenant_role),
  public.transfer_ownership(uuid)
from public, anon, authenticated;

grant execute on function public.get_invitation(text) to anon, authenticated;
grant execute on function
  public.accept_invitation(text),
  public.set_member_role(uuid, public.tenant_role),
  public.transfer_ownership(uuid)
to authenticated;

revoke all on function
  private.join_via_invitation(uuid, text, text, text),
  private.unique_tenant_slug(text),
  private.handle_new_auth_user()
from public, anon, authenticated;
