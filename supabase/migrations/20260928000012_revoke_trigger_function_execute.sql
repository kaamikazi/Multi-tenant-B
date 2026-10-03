-- Found by the meta-security suite (supabase/tests/database/11_meta_security):
-- the two generic trigger functions from the first migration kept Postgres's
-- default EXECUTE grant to PUBLIC, so anon and authenticated held EXECUTE on
-- them. Not exploitable (trigger functions can't be called directly, anon has
-- no USAGE on the private schema, and the private schema isn't exposed by the
-- API), but every other private trigger function is locked down, and the
-- suite now fails on any private function anon can execute.
--
-- Triggers keep working: EXECUTE on a trigger function is checked when the
-- trigger is created, not each time it fires.

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.prevent_tenant_id_change() from public, anon, authenticated;
