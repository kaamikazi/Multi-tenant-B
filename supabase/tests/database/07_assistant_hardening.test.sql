-- Assistant hardening: message provenance, execution budgets, AI switch.
begin;
select plan(25);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'owner@acme.test',   '{"company_name": "Acme"}'),
  ('b0000000-0000-0000-0000-000000000001', 'owner@globex.test', '{"company_name": "Globex"}'),
  ('a0000000-0000-0000-0000-000000000002', 'admin@acme.test',   '{}'),
  ('a0000000-0000-0000-0000-000000000003', 'mia@acme.test',     '{}');
select set_config('test.acme', (select tenant_id::text from public.users where id = 'a0000000-0000-0000-0000-000000000001'), true);
delete from public.tenants where id in (select tenant_id from public.users where id in
  ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003'));
insert into public.users (id, tenant_id, email, role) values
  ('a0000000-0000-0000-0000-000000000002', current_setting('test.acme')::uuid, 'admin@acme.test', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', current_setting('test.acme')::uuid, 'mia@acme.test',   'member');
update public.tenants set plan = 'pro' where id = current_setting('test.acme')::uuid;

select pg_temp.login('a0000000-0000-0000-0000-000000000003'); -- mia
insert into public.chat_threads (title) values ('T1'), ('T2'), ('T3');
select set_config('test.t1', (select id::text from public.chat_threads where title = 'T1'), true);
select set_config('test.t2', (select id::text from public.chat_threads where title = 'T2'), true);
select set_config('test.t3', (select id::text from public.chat_threads where title = 'T3'), true);

-- ---------------------------------------------------------------------------
-- Provenance: clients write plain questions only
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.chat_messages (thread_id, role, content) values (current_setting('test.t1')::uuid, 'assistant', 'forged') $$,
  '42501', null, 'a client cannot insert an assistant-role message');

select throws_ok(
  $$ insert into public.chat_messages (thread_id, content, tools_used) values (current_setting('test.t1')::uuid, 'hi', '{get_billing_status}') $$,
  '42501', null, 'a client cannot forge tools_used');

select throws_ok(
  $$ insert into public.chat_messages (thread_id, content, tokens_used) values (current_setting('test.t1')::uuid, 'hi', 5) $$,
  '42501', null, 'a client cannot forge token accounting');

select throws_ok(
  $$ select public.record_assistant_message(current_setting('test.t1')::uuid, 'a0000000-0000-0000-0000-000000000003', 'forged') $$,
  '42501', null, 'a client cannot call the server-only reply function');

select throws_ok(
  $$ insert into public.chat_messages (thread_id, content) values (current_setting('test.t1')::uuid, repeat('x', 4001)) $$,
  '23514', null, 'questions longer than 4000 characters are rejected');

select lives_ok(
  $$ insert into public.chat_messages (thread_id, content) values (current_setting('test.t1')::uuid, 'Who is on my team?') $$,
  'a client can ask a question in its own conversation');

select results_eq(
  $$ select role, cardinality(tools_used) from public.chat_messages where thread_id = current_setting('test.t1')::uuid $$,
  $$ values ('user', 0) $$,
  'the stored question has role user and no tools');

select pg_temp.login('a0000000-0000-0000-0000-000000000001'); -- owner
select throws_ok(
  $$ insert into public.chat_messages (thread_id, content) values (current_setting('test.t1')::uuid, 'owner snooping') $$,
  '42501', null, 'the owner cannot write into a member''s conversation');

select pg_temp.login('b0000000-0000-0000-0000-000000000001'); -- other tenant
select throws_ok(
  $$ insert into public.chat_messages (thread_id, content) values (current_setting('test.t1')::uuid, 'cross-tenant') $$,
  '42501', null, 'another tenant cannot write into the conversation');

-- Regression: the budget trigger must not reveal another user's thread state.
select pg_temp.logout();
update public.chat_threads set generating_until = now() + interval '1 minute' where id = current_setting('test.t1')::uuid;
select pg_temp.login('b0000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ insert into public.chat_messages (thread_id, content) values (current_setting('test.t1')::uuid, 'probe') $$,
  '42501', null, 'probing a generating thread in another tenant gets permission denied, not its state');
select pg_temp.logout();
update public.chat_threads set generating_until = null where id = current_setting('test.t1')::uuid;

-- ---------------------------------------------------------------------------
-- The trusted server path
-- ---------------------------------------------------------------------------
select pg_temp.logout();
set local role anon;
select throws_ok(
  $$ select public.record_assistant_message(current_setting('test.t1')::uuid, 'a0000000-0000-0000-0000-000000000003', 'forged') $$,
  '42501', null, 'anonymous callers cannot store assistant replies');
reset role;

set local role service_role;
select throws_ok(
  $$ select public.record_assistant_message(current_setting('test.t1')::uuid, 'a0000000-0000-0000-0000-000000000001', 'wrong user') $$,
  'P0002', null, 'the server path refuses a thread that is not the stated user''s');

select throws_ok(
  $$ select public.record_assistant_message(current_setting('test.t1')::uuid, 'a0000000-0000-0000-0000-000000000003', 'x',
       array(select 't' || n from generate_series(1, 17) n)) $$,
  '23514', null, 'tools_used is bounded');

select lives_ok(
  $$ select public.record_assistant_message(current_setting('test.t1')::uuid, 'a0000000-0000-0000-0000-000000000003',
       'Your team has 3 people.', '{list_team_members}', 812) $$,
  'the server can store an assistant reply with provenance');
reset role;

select results_eq(
  $$ select role, tools_used::text, tokens_used from public.chat_messages
      where thread_id = current_setting('test.t1')::uuid order by created_at $$,
  $$ values ('user', '{}', null::int), ('assistant', '{list_team_members}', 812) $$,
  'history holds the real question and the server-written reply');

select is(
  (select generating_until from public.chat_threads where id = current_setting('test.t1')::uuid), null,
  'storing the reply releases the generation lease');

-- ---------------------------------------------------------------------------
-- Execution budgets
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000003');
insert into public.chat_messages (thread_id, content) values (current_setting('test.t2')::uuid, 'first');

select throws_like(
  $$ insert into public.chat_messages (thread_id, content) values (current_setting('test.t2')::uuid, 'second') $$,
  '%still answering%', 'one generation at a time per conversation');

select pg_temp.logout();
update public.chat_threads set generating_until = now() + interval '1 minute' where id = current_setting('test.t1')::uuid;
select pg_temp.login('a0000000-0000-0000-0000-000000000003');

select throws_like(
  $$ insert into public.chat_messages (thread_id, content) values (current_setting('test.t3')::uuid, 'third') $$,
  '%two answers in progress%', 'at most two concurrent generations per user');

select pg_temp.logout();
update public.chat_threads set generating_until = now() - interval '1 second'
 where id in (current_setting('test.t1')::uuid, current_setting('test.t2')::uuid);
select pg_temp.login('a0000000-0000-0000-0000-000000000003');

select lives_ok(
  $$ insert into public.chat_messages (thread_id, content) values (current_setting('test.t2')::uuid, 'after expiry') $$,
  'an expired lease no longer blocks the conversation');

-- Per-user rate: 6 per minute (the 3 accepted questions above count).
select pg_temp.logout();
update public.chat_threads set generating_until = null;
insert into private.ai_usage (tenant_id, user_id)
select current_setting('test.acme')::uuid, 'a0000000-0000-0000-0000-000000000003' from generate_series(1, 3);
select pg_temp.login('a0000000-0000-0000-0000-000000000003');

select throws_like(
  $$ insert into public.chat_messages (thread_id, content) values (current_setting('test.t3')::uuid, 'too fast') $$,
  '%too quickly%', 'a seventh question within a minute is refused');

-- ---------------------------------------------------------------------------
-- Workspace AI switch (owner only)
-- ---------------------------------------------------------------------------
select is_empty(
  $$ update public.tenants set ai_enabled = false returning id $$,
  'a member cannot turn the assistant off');

select pg_temp.login('a0000000-0000-0000-0000-000000000002'); -- admin
select is_empty(
  $$ update public.tenants set ai_enabled = false returning id $$,
  'an admin cannot turn the assistant off');

select pg_temp.login('a0000000-0000-0000-0000-000000000001'); -- owner
select isnt_empty(
  $$ update public.tenants set ai_enabled = false where id = current_setting('test.acme')::uuid returning id $$,
  'the owner can turn the assistant off');

insert into public.chat_threads (title) values ('Owner chat');
select throws_like(
  $$ insert into public.chat_messages (thread_id, content)
     select id, 'hello' from public.chat_threads where title = 'Owner chat' $$,
  '%turned off%', 'with AI off, the database refuses new questions');

select results_eq(
  'select ai_enabled from public.get_ai_usage()', $$ values (false) $$,
  'usage reports the switch so the UI can explain it');

select * from finish();
rollback;
