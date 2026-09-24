-- AI assistant: private conversations and per-plan monthly message limits.
begin;
select plan(19);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true);
$$;

-- Acme: owner + member. Globex: owner.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'owner@acme.test',   '{"company_name": "Acme"}'),
  ('b0000000-0000-0000-0000-000000000001', 'owner@globex.test', '{"company_name": "Globex"}'),
  ('a0000000-0000-0000-0000-000000000002', 'member@acme.test',  '{}');
select set_config('test.acme', (select tenant_id::text from public.users where id = 'a0000000-0000-0000-0000-000000000001'), true);
delete from public.tenants where id = (select tenant_id from public.users where id = 'a0000000-0000-0000-0000-000000000002');
insert into public.users (id, tenant_id, email, role) values
  ('a0000000-0000-0000-0000-000000000002', current_setting('test.acme')::uuid, 'member@acme.test', 'member');

-- ---------------------------------------------------------------------------
-- Conversations are private to their author
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000002'); -- acme member

select lives_ok(
  $$ insert into public.chat_threads (title) values ('Member chat') $$,
  'a member can start a conversation'
);
select set_config('test.thread', (select id::text from public.chat_threads where title = 'Member chat'), true);

select results_eq(
  $$ select user_id::text, tenant_id::text from public.chat_threads $$,
  $$ values ('a0000000-0000-0000-0000-000000000002', current_setting('test.acme')) $$,
  'owner and tenant of a conversation come from the session, not the client'
);

select lives_ok(
  $$ insert into public.chat_messages (thread_id, role, content)
     values (current_setting('test.thread')::uuid, 'user', 'How many people are on my team?') $$,
  'a member can post in their own conversation'
);

select throws_ok(
  $$ insert into public.chat_threads (tenant_id, title) values (gen_random_uuid(), 'x') $$,
  '42501', null,
  'clients cannot choose a conversation''s tenant'
);

select throws_ok(
  $$ update public.chat_messages set content = 'rewritten' $$,
  '42501', null,
  'messages cannot be edited'
);

select throws_ok(
  $$ delete from public.chat_messages $$,
  '42501', null,
  'messages cannot be deleted one by one'
);

select pg_temp.login('a0000000-0000-0000-0000-000000000001'); -- acme owner

select is_empty(
  'select 1 from public.chat_threads union all select 1 from public.chat_messages',
  'even the owner cannot read a member''s conversations'
);

select throws_ok(
  $$ insert into public.chat_messages (thread_id, role, content)
     values (current_setting('test.thread')::uuid, 'assistant', 'injected') $$,
  '42501', null,
  'nobody can write into someone else''s conversation'
);

select pg_temp.login('b0000000-0000-0000-0000-000000000001'); -- globex owner

select is_empty(
  'select 1 from public.chat_threads union all select 1 from public.chat_messages',
  'another tenant sees no conversations'
);

select throws_ok(
  $$ insert into public.chat_messages (thread_id, role, content)
     values (current_setting('test.thread')::uuid, 'user', 'cross-tenant') $$,
  '42501', null,
  'another tenant cannot post into the conversation by id'
);

-- ---------------------------------------------------------------------------
-- Monthly AI allowance (Free: 25 per workspace)
-- ---------------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000002'); -- acme member

select results_eq(
  'select used, message_limit from public.get_ai_usage()',
  $$ values (1, 25) $$,
  'each user message uses one unit of the workspace''s allowance'
);

select lives_ok(
  $$ insert into public.chat_messages (thread_id, role, content)
     values (current_setting('test.thread')::uuid, 'assistant', 'You have 2 people.') $$,
  'assistant replies can be stored'
);

select results_eq(
  'select used from public.get_ai_usage()',
  $$ values (1) $$,
  'assistant replies do not count against the allowance'
);

select throws_ok(
  $$ insert into public.chat_messages (thread_id, role, content)
     select current_setting('test.thread')::uuid, 'user', 'bulk ' || n from generate_series(1, 30) n $$,
  '54000', null,
  'one bulk insert cannot exceed the monthly allowance'
);

select lives_ok(
  $$ insert into public.chat_messages (thread_id, role, content)
     select current_setting('test.thread')::uuid, 'user', 'msg ' || n from generate_series(1, 24) n $$,
  'messages up to the allowance are accepted'
);

select throws_ok(
  $$ insert into public.chat_messages (thread_id, role, content)
     values (current_setting('test.thread')::uuid, 'user', 'one too many') $$,
  '54000', null,
  'the 26th message of the month is refused'
);

select lives_ok(
  $$ delete from public.chat_threads where id = current_setting('test.thread')::uuid $$,
  'a user can delete their own conversation'
);

select results_eq(
  'select used from public.get_ai_usage()',
  $$ values (25) $$,
  'deleting conversations does not refund the allowance'
);

select pg_temp.login('b0000000-0000-0000-0000-000000000001'); -- globex owner
select results_eq(
  'select used, message_limit from public.get_ai_usage()',
  $$ values (0, 25) $$,
  'another tenant''s allowance is unaffected'
);

select * from finish();
rollback;
