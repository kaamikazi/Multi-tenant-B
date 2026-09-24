-- =============================================================================
-- AI assistant: conversations, messages and per-plan monthly usage limits.
--
--   * Conversations are private to the user who started them. Other people in
--     the tenant, the owner included, cannot read them.
--   * The assistant answers questions by calling read-only tools that run with
--     the signed-in user's own session. It inherits that user's RLS, so it can
--     never see another tenant's data or anything the user's role can't see.
--   * Each user message costs one unit of the tenant's monthly allowance
--     (Free 25, Pro 1000), enforced per row by a BEFORE INSERT trigger (see the
--     seat-limit fix migration for why not a policy). Usage is written to a
--     private ledger, so deleting conversations does not refund it.
-- =============================================================================

create table public.chat_threads (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default private.current_tenant_id()
              references public.tenants (id) on delete cascade,
  user_id     uuid not null default auth.uid()
              references public.users (id) on delete cascade,
  title       text not null default 'New conversation' check (char_length(title) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- lets chat_messages prove its thread is in the same tenant
  unique (id, tenant_id)
);

create index chat_threads_user_idx on public.chat_threads (user_id, updated_at desc);
create index chat_threads_tenant_id_idx on public.chat_threads (tenant_id);

create table public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default private.current_tenant_id()
              references public.tenants (id) on delete cascade,
  thread_id   uuid not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null check (char_length(content) between 1 and 12000),
  tools_used  text[] not null default '{}',
  created_at  timestamptz not null default now(),
  foreign key (thread_id, tenant_id) references public.chat_threads (id, tenant_id) on delete cascade
);

create index chat_messages_thread_idx on public.chat_messages (thread_id, created_at);
create index chat_messages_tenant_id_idx on public.chat_messages (tenant_id);

create trigger chat_threads_set_updated_at
  before update on public.chat_threads
  for each row execute function private.set_updated_at();

create trigger chat_threads_prevent_tenant_id_change
  before update on public.chat_threads
  for each row execute function private.prevent_tenant_id_change();

create trigger chat_messages_prevent_tenant_id_change
  before update on public.chat_messages
  for each row execute function private.prevent_tenant_id_change();

-- ---------------------------------------------------------------------------
-- Usage ledger (private: not reachable through the Data API)
-- ---------------------------------------------------------------------------
create table private.ai_usage (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  user_id     uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index ai_usage_tenant_month_idx on private.ai_usage (tenant_id, created_at);

-- null = unlimited. Keep in sync with PLANS in src/lib/billing.ts.
create function private.ai_message_limit(p_plan public.plan)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan when 'free' then 25 when 'pro' then 1000 end
$$;

create function private.ai_messages_used(p_tenant uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from private.ai_usage
   where tenant_id = p_tenant and created_at >= date_trunc('month', now())
$$;

-- Checks the allowance and records one unit, per row, under a lock on the
-- tenant so bulk inserts and concurrent requests are all counted.
create function private.enforce_ai_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_cap integer;
begin
  select private.ai_message_limit(plan) into message_cap
    from public.tenants where id = new.tenant_id
     for update;

  if message_cap is not null and private.ai_messages_used(new.tenant_id) >= message_cap then
    raise exception 'This workspace has used all % AI messages for this month.', message_cap
      using errcode = '54000'; -- program_limit_exceeded
  end if;

  insert into private.ai_usage (tenant_id, user_id) values (new.tenant_id, (select auth.uid()));
  return new;
end;
$$;

create trigger chat_messages_enforce_ai_quota
  before insert on public.chat_messages
  for each row when (new.role = 'user')
  execute function private.enforce_ai_quota();

create function public.get_ai_usage()
returns table (used integer, message_limit integer)
language sql
stable
security definer
set search_path = ''
as $$
  select private.ai_messages_used(t.id), private.ai_message_limit(t.plan)
    from public.tenants t
   where t.id = private.current_tenant_id()
$$;

revoke all on table private.ai_usage from public, anon, authenticated;
revoke all on function
  private.ai_message_limit(public.plan),
  private.ai_messages_used(uuid),
  private.enforce_ai_quota()
from public, anon, authenticated;
revoke all on function public.get_ai_usage() from public, anon;
grant execute on function public.get_ai_usage() to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
revoke all on public.chat_threads, public.chat_messages from anon, authenticated;

grant select, delete on public.chat_threads to authenticated;
grant insert (title) on public.chat_threads to authenticated;
grant update (title) on public.chat_threads to authenticated;

-- Messages are append-only for clients: no update, no delete (threads cascade).
grant select on public.chat_messages to authenticated;
grant insert (thread_id, role, content, tools_used) on public.chat_messages to authenticated;

alter table public.chat_threads  enable row level security;
alter table public.chat_messages enable row level security;

create policy "users manage their own conversations"
  on public.chat_threads for all
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and user_id = (select auth.uid())
  )
  with check (
    tenant_id = (select private.current_tenant_id())
    and user_id = (select auth.uid())
  );

create policy "users read messages in their own conversations"
  on public.chat_messages for select
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and exists (
      select 1 from public.chat_threads t
       where t.id = thread_id and t.user_id = (select auth.uid())
    )
  );

create policy "users add messages to their own conversations"
  on public.chat_messages for insert
  to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and exists (
      select 1 from public.chat_threads t
       where t.id = thread_id and t.user_id = (select auth.uid())
    )
  );
