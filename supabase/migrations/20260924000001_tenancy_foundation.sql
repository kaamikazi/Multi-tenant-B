-- =============================================================================
-- Tenancy foundation: tenants, users, roles, and Row Level Security.
--
-- Isolation model
--   * Every tenant-owned table carries a NOT NULL tenant_id.
--   * RLS is enabled on every table; policies compare tenant_id against
--     private.current_tenant_id(), which is derived from auth.uid() on the
--     server. The client never supplies its own tenant id, so it cannot lie
--     about which tenant it belongs to.
--   * The anon role has no table privileges at all.
--   * Writes that need business rules (creating a tenant, changing roles,
--     inviting users) go through SECURITY DEFINER functions added in later
--     migrations, not through broad UPDATE grants.
--
-- Adding a new tenant-scoped table: copy the pattern at the bottom of this file.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.tenant_role as enum ('owner', 'admin', 'member');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  slug        text not null unique
              check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.tenants is
  'A customer organization. Root of all tenant-scoped data.';

-- One row per auth user. A user belongs to exactly one tenant.
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  email       text not null,
  full_name   text check (char_length(full_name) <= 100),
  role        public.tenant_role not null default 'member',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.users is
  'Application profile for an auth user: which tenant they belong to and their role in it.';

create index users_tenant_id_idx on public.users (tenant_id);

-- Every tenant has at most one owner. Ownership transfer demotes, then promotes.
create unique index users_one_owner_per_tenant
  on public.users (tenant_id) where role = 'owner';

-- ---------------------------------------------------------------------------
-- Private helper schema (not exposed through the Data API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- SECURITY DEFINER so policies on public.users can call these without
-- recursing into public.users' own RLS. search_path is pinned to '' so the
-- functions cannot be hijacked by objects in a caller-controlled schema.

create function private.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tenant_id from public.users where id = (select auth.uid())
$$;

create function private.current_user_role()
returns public.tenant_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.users where id = (select auth.uid())
$$;

-- True when the caller has one of the given roles in their tenant.
create function private.has_role(variadic roles public.tenant_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select role = any (roles) from public.users where id = (select auth.uid())),
    false
  )
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- tenant_id is immutable for every role, including service_role. Moving a
-- row between tenants is never a legitimate operation; delete and recreate.
create function private.prevent_tenant_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable on %', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function private.set_updated_at();

create trigger users_set_updated_at
  before update on public.users
  for each row execute function private.set_updated_at();

create trigger users_prevent_tenant_id_change
  before update on public.users
  for each row execute function private.prevent_tenant_id_change();

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Supabase grants ALL on public tables to anon and authenticated by default.
-- Start from nothing and grant back only what the app needs; RLS then limits
-- which rows those privileges apply to.
-- ---------------------------------------------------------------------------
revoke all on public.tenants, public.users from anon, authenticated;

grant select on public.tenants to authenticated;
grant update (name) on public.tenants to authenticated;

grant select on public.users to authenticated;
-- Users may edit their own display name. role and tenant_id are not
-- updatable by clients; role changes go through a checked RPC (Phase 2).
grant update (full_name) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.users   enable row level security;

-- tenants ----------------------------------------------------------------
create policy "members can read their own tenant"
  on public.tenants for select
  to authenticated
  using (id = (select private.current_tenant_id()));

create policy "owners can rename their tenant"
  on public.tenants for update
  to authenticated
  using (
    id = (select private.current_tenant_id())
    and (select private.has_role('owner'))
  )
  with check (id = (select private.current_tenant_id()));

-- users ------------------------------------------------------------------
create policy "members can read users in their tenant"
  on public.users for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "users can update their own profile"
  on public.users for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- =============================================================================
-- Pattern for every future tenant-scoped table (leads, appointments, ...):
--
--   create table public.<thing> (
--     id         uuid primary key default gen_random_uuid(),
--     tenant_id  uuid not null default private.current_tenant_id()
--                references public.tenants (id) on delete cascade,
--     ...
--   );
--   create index <thing>_tenant_id_idx on public.<thing> (tenant_id);
--   create trigger <thing>_prevent_tenant_id_change before update on public.<thing>
--     for each row execute function private.prevent_tenant_id_change();
--   revoke all on public.<thing> from anon, authenticated;
--   grant select, insert, update, delete on public.<thing> to authenticated;
--   alter table public.<thing> enable row level security;
--   create policy "tenant isolation" on public.<thing> for all to authenticated
--     using      (tenant_id = (select private.current_tenant_id()))
--     with check (tenant_id = (select private.current_tenant_id()));
--   -- then add role-specific policies (as restrictive) where needed.
-- =============================================================================
