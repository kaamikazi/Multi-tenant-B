-- Meta-security: checks the SHAPE of the schema so that a future migration
-- that forgets RLS, a grant, a search_path or a trigger fails here, even if
-- nobody writes a test for the new object. Every allowlist below is a
-- reviewed decision; adding to one should be a deliberate, reviewed change.
begin;
select plan(25);

-- ---------------------------------------------------------------------------
-- Tables and views
-- ---------------------------------------------------------------------------

-- Invariant: no public table is readable without a policy.
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1),
  '{}'::text[],
  'RLS is enabled on every public table');

-- Invariant: all tenant data carries tenant_id. Only the tenants table itself
-- (keyed by id) is exempt.
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p')
           and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
         order by 1),
  array['tenants'],
  'every public table except tenants has a tenant_id column');

-- Invariant: a row can never be moved to another tenant.
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p')
           and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
           and not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                            where t.tgrelid = c.oid and p.proname = 'prevent_tenant_id_change'
                              and t.tgtype & 16 = 16)  -- fires on UPDATE
         order by 1),
  '{}'::text[],
  'every tenant-scoped table has the prevent_tenant_id_change UPDATE trigger');

-- Invariant: the tenant_id column itself is never client-updatable.
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
         where n.nspname = 'public' and c.relkind in ('r', 'p')
           and has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
         order by 1),
  '{}'::text[],
  'authenticated cannot UPDATE tenant_id on any table');

-- Invariant: anonymous visitors reach data only through the reviewed RPCs.
select is(
  array(select distinct c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
           and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                or (c.relkind = 'S' and has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE'))
                or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0
                             and has_column_privilege('anon', c.oid, a.attnum, 'SELECT, INSERT, UPDATE, REFERENCES')))
         order by 1),
  '{}'::text[],
  'anon has no privileges on any public table, view or sequence');

-- Invariant: clients can't bulk-wipe or re-wire tables.
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p')
           and has_table_privilege('authenticated', c.oid, 'TRUNCATE, REFERENCES, TRIGGER')
         order by 1),
  '{}'::text[],
  'authenticated has no TRUNCATE, REFERENCES or TRIGGER on any table');

-- Invariant: a view never bypasses the caller's RLS.
select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('v', 'm')
           and not coalesce('security_invoker=true' = any(c.reloptions), false)
         order by 1),
  '{}'::text[],
  'every public view is security_invoker');

-- Invariants on specific privileged columns (entitlement, roles, provenance).
select ok(not has_column_privilege('authenticated', 'public.tenants', 'plan', 'UPDATE'),
  'a client cannot change its own plan (tenants.plan)');
select ok(not has_table_privilege('authenticated', 'public.billing', 'INSERT, UPDATE, DELETE'),
  'a client cannot write billing state');
select ok(not has_column_privilege('authenticated', 'public.users', 'role', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.users', 'role', 'INSERT'),
  'a client cannot set its own role (users.role)');
select ok(not has_column_privilege('authenticated', 'public.chat_messages', 'role', 'INSERT')
          and not has_column_privilege('authenticated', 'public.chat_messages', 'tools_used', 'INSERT')
          and not has_column_privilege('authenticated', 'public.chat_messages', 'tokens_used', 'INSERT')
          and not has_table_privilege('authenticated', 'public.chat_messages', 'UPDATE'),
  'a client cannot forge assistant rows, tool provenance or token counts');

-- Invariant: input size is bounded by the database, not just the UI. Every
-- text column a client can write is covered by a CHECK constraint.
select is(
  array(select c.relname || '.' || a.attname from pg_attribute a
           join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
           and a.atttypid in ('text'::regtype, 'varchar'::regtype)
           and (has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT')
                or has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE'))
           and not exists (select 1 from pg_constraint k
                            where k.conrelid = c.oid and k.contype = 'c' and a.attnum = any(k.conkey))
         order by 1),
  '{}'::text[],
  'every client-writable text column has a CHECK constraint (length bound)');

-- Invariant: bearer tokens are not readable by normal users.
select ok(not has_column_privilege('authenticated', 'public.appointments', 'cancel_token', 'SELECT')
          and not has_column_privilege('anon', 'public.appointments', 'cancel_token', 'SELECT'),
  'booking cancel tokens are not selectable by clients');

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Invariant: SECURITY DEFINER bypasses RLS, so each one is individually
-- reviewed. A new one must be added here on purpose.
select set_eq(
  $$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'private') $$,
  array[
    -- RLS helpers (read only the caller's own row)
    'private.current_tenant_id', 'private.current_user_role', 'private.has_role',
    -- seat and quota accounting
    'private.seats_used', 'private.ai_messages_used', 'private.enforce_seat_limit', 'private.enforce_ai_quota',
    -- sign-up and invitation flows
    'private.handle_new_auth_user', 'private.join_via_invitation', 'public.accept_invitation', 'public.get_invitation',
    -- owner-only role management
    'public.set_member_role', 'public.transfer_ownership',
    -- usage readouts for the caller's tenant
    'public.get_ai_usage', 'public.get_seat_usage',
    -- assistant provenance (service_role only)
    'public.record_assistant_message',
    -- public booking page (anon, token/slug scoped)
    'public.get_booking_page', 'public.get_open_slots', 'public.get_booking', 'public.cancel_booking',
    'public.book_appointment', 'private.create_booking_settings', 'private.open_slots'
  ],
  'SECURITY DEFINER functions match the reviewed allowlist');

-- Invariant: a definer function can't be hijacked through search_path.
select is(
  array(select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'private')
           and not coalesce('search_path=""' = any(p.proconfig), false)
         order by 1),
  '{}'::text[],
  'every SECURITY DEFINER function pins search_path to empty');

-- Invariant: anon can call exactly the public booking and invitation RPCs.
select set_eq(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  array['get_invitation', 'get_booking_page', 'get_open_slots', 'book_appointment', 'get_booking', 'cancel_booking'],
  'anon EXECUTE on public functions matches the allowlist');

select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1),
  '{}'::text[],
  'anon cannot execute any private function');

select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon has no USAGE on the private schema');

-- Invariant: signed-in users can call exactly these.
select set_eq(
  $$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('authenticated', p.oid, 'EXECUTE') $$,
  array[
    -- used inside RLS policies and the leads_scored view
    'private.current_tenant_id', 'private.current_user_role', 'private.has_role',
    'private.seat_limit', 'private.seats_used', 'private.score_lead',
    -- app RPCs
    'public.accept_invitation', 'public.set_member_role', 'public.transfer_ownership',
    'public.get_ai_usage', 'public.get_seat_usage', 'public.get_invitation',
    'public.ai_team_overview', 'public.ai_pipeline_summary', 'public.ai_list_leads', 'public.ai_list_appointments',
    -- booking RPCs are public, so signed-in visitors may use them too
    'public.get_booking_page', 'public.get_open_slots', 'public.get_booking', 'public.cancel_booking', 'public.book_appointment'
  ],
  'authenticated EXECUTE matches the allowlist');

-- Invariant: only the server (service_role) writes assistant replies.
select ok(not has_function_privilege('authenticated', 'public.record_assistant_message(uuid, uuid, text, text[], integer)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.record_assistant_message(uuid, uuid, text, text[], integer)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.record_assistant_message(uuid, uuid, text, text[], integer)', 'EXECUTE'),
  'record_assistant_message is service_role only');

-- Invariant: the AI data functions run with the caller's rights (RLS applies).
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'ai\_%' and p.prosecdef order by 1),
  '{}'::text[],
  'ai_* tool functions are SECURITY INVOKER');

-- ---------------------------------------------------------------------------
-- Behaviour behind the grants: invitation tokens
-- ---------------------------------------------------------------------------
-- invitations.token is column-readable by authenticated on purpose: owners and
-- admins copy invite links. RLS must keep it away from plain members.
create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1000000-0000-0000-0000-000000000001', 'owner@meta.test', '{"company_name": "Meta Co"}');
select pg_temp.login('b1000000-0000-0000-0000-000000000001');
insert into public.invitations (email, role) values ('member@meta.test', 'member'), ('later@meta.test', 'member');
select pg_temp.logout();
insert into auth.users (id, email, raw_user_meta_data)
values ('b1000000-0000-0000-0000-000000000002', 'member@meta.test',
        json_build_object('invite_token', (select token from public.invitations where email = 'member@meta.test'))::jsonb);

select pg_temp.login('b1000000-0000-0000-0000-000000000002');
select is((select role::text from public.users where id = 'b1000000-0000-0000-0000-000000000002'), 'member',
  'fixture: the invited person joined as a member');
select is((select count(*)::int from public.invitations), 0,
  'a member cannot read any invitation (or its token)');
select pg_temp.logout();

select pg_temp.login('b1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.invitations where token is not null), 2,
  'the owner can read the invitation links');
select pg_temp.logout();

-- Invariant: bearer tokens have enough entropy to be unguessable.
select ok((select bool_and(length(token) >= 32) from public.invitations), 'invitation tokens are at least 32 characters');

select * from finish();
rollback;
