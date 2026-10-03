-- =============================================================================
-- Assistant hardening: server-authoritative message provenance, execution
-- budgets, and a per-workspace AI switch.
--
-- Problem fixed: clients could INSERT chat_messages with role = 'assistant'
-- and arbitrary tools_used. Only their own conversation was affected, but that
-- history is replayed to the model as model-role context, so a user could
-- forge "what the assistant said" and steer later answers.
--
-- Invariants after this migration:
--   * Clients can insert only (thread_id, content). role is always 'user' and
--     tools_used always '{}' for client rows (column grants + RLS + CHECK).
--   * Assistant rows are written only by public.record_assistant_message(),
--     executable by service_role alone, which checks the thread belongs to the
--     user the server is answering.
--   * Per-user budgets, enforced in the same per-row trigger as the monthly
--     quota: 6 messages/minute, 1 generation per conversation, 2 concurrent
--     generations per user. A generation "lease" expires after 2 minutes, so a
--     crashed request can't lock a conversation forever.
--   * Owners can turn the assistant off for their workspace; the database then
--     refuses new questions, whatever the UI does.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.tenants add column ai_enabled boolean not null default true;
grant update (ai_enabled) on public.tenants to authenticated;  -- owner-only via the existing tenants UPDATE policy

alter table public.chat_threads add column generating_until timestamptz;

alter table public.chat_messages add column tokens_used integer check (tokens_used is null or tokens_used >= 0);

-- Clients no longer send role, so it must default to the only value they may write.
alter table public.chat_messages alter column role set default 'user';

alter table public.chat_messages
  add constraint chat_messages_user_rows_are_plain check (
    role <> 'user' or (tools_used = '{}' and tokens_used is null and char_length(content) <= 4000)
  ),
  add constraint chat_messages_tools_used_bounded check (
    cardinality(tools_used) <= 16
  );

create index ai_usage_user_recent_idx on private.ai_usage (user_id, created_at);

-- ---------------------------------------------------------------------------
-- Client privileges: user messages only
-- ---------------------------------------------------------------------------
revoke insert on public.chat_messages from authenticated;
grant insert (thread_id, content) on public.chat_messages to authenticated;

drop policy "users add messages to their own conversations" on public.chat_messages;
create policy "users add their own questions to their own conversations"
  on public.chat_messages for insert
  to authenticated
  with check (
    role = 'user'
    and tools_used = '{}'
    and tenant_id = (select private.current_tenant_id())
    and exists (
      select 1 from public.chat_threads t
       where t.id = thread_id and t.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Quota + budgets (replaces the trigger function from the assistant migration)
-- ---------------------------------------------------------------------------
create or replace function private.enforce_ai_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  public.tenants;
  v_cap     integer;
  v_user    uuid := (select auth.uid());
begin
  -- BEFORE triggers run ahead of RLS. If this isn't the caller's own
  -- conversation, step aside and let RLS refuse it: answering "still
  -- generating" here would leak another user's (or tenant's) thread state.
  if v_user is not null and not exists (
    select 1 from public.chat_threads
     where id = new.thread_id and user_id = v_user and tenant_id = new.tenant_id
  ) then
    return new;
  end if;

  -- Serialises checks per tenant so bulk and concurrent inserts are all counted.
  select * into v_tenant from public.tenants where id = new.tenant_id for update;

  if not v_tenant.ai_enabled then
    raise exception 'The AI assistant is turned off for this workspace.' using errcode = '42501';
  end if;

  v_cap := private.ai_message_limit(v_tenant.plan);
  if v_cap is not null and private.ai_messages_used(new.tenant_id) >= v_cap then
    raise exception 'This workspace has used all % AI messages for this month.', v_cap
      using errcode = '54000'; -- program_limit_exceeded
  end if;

  if v_user is not null then
    if (select count(*) from private.ai_usage
         where user_id = v_user and created_at > now() - interval '1 minute') >= 6 then
      raise exception 'You are sending messages too quickly. Please wait a minute.' using errcode = '54000';
    end if;

    if exists (select 1 from public.chat_threads
                where id = new.thread_id and generating_until > now()) then
      raise exception 'The assistant is still answering in this conversation.' using errcode = '54000';
    end if;

    if (select count(*) from public.chat_threads
         where user_id = v_user and generating_until > now()) >= 2 then
      raise exception 'You already have two answers in progress. Please wait for one to finish.' using errcode = '54000';
    end if;
  end if;

  -- Lease: this conversation is generating until the reply is recorded or it expires.
  update public.chat_threads set generating_until = now() + interval '2 minutes' where id = new.thread_id;

  insert into private.ai_usage (tenant_id, user_id) values (new.tenant_id, v_user);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The only way to store an assistant reply
-- ---------------------------------------------------------------------------
create function public.record_assistant_message(
  p_thread  uuid,
  p_user    uuid,
  p_content text,
  p_tools   text[] default '{}',
  p_tokens  integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread  public.chat_threads;
  v_id      uuid;
begin
  select * into v_thread from public.chat_threads where id = p_thread for update;
  if not found or v_thread.user_id is distinct from p_user then
    raise exception 'Conversation not found for this user.' using errcode = 'P0002';
  end if;

  insert into public.chat_messages (tenant_id, thread_id, role, content, tools_used, tokens_used)
  values (v_thread.tenant_id, p_thread, 'assistant',
          left(coalesce(nullif(trim(p_content), ''), 'I don''t have an answer for that.'), 12000),
          coalesce(p_tools, '{}'), p_tokens)
  returning id into v_id;

  -- Releases the generation lease and moves the conversation to the top.
  update public.chat_threads set generating_until = null, updated_at = now() where id = p_thread;
  return v_id;
end;
$$;

revoke all on function public.record_assistant_message(uuid, uuid, text, text[], integer) from public, anon, authenticated;
grant execute on function public.record_assistant_message(uuid, uuid, text, text[], integer) to service_role;

-- get_ai_usage also reports whether the assistant is on.
drop function public.get_ai_usage();
create function public.get_ai_usage()
returns table (used integer, message_limit integer, ai_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select private.ai_messages_used(t.id), private.ai_message_limit(t.plan), t.ai_enabled
    from public.tenants t
   where t.id = private.current_tenant_id()
$$;

revoke all on function public.get_ai_usage() from public, anon;
grant execute on function public.get_ai_usage() to authenticated;
