-- Bootstrap: extensions, private schema, and least-privilege defaults.
--
-- SECURITY (review finding H1): Supabase ships a blanket GRANT ALL on public
-- to anon/authenticated. Revoking only SELECT/INSERT/UPDATE/DELETE leaves
-- TRUNCATE, REFERENCES and TRIGGER behind — an anon caller could TRUNCATE
-- tables that no FK cascade protects. Revoke ALL, then grant back explicitly
-- in the RLS migration.

create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Helper functions the client must never reach directly.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, anon;

-- Future objects created by postgres in public are closed by default.
alter default privileges for role postgres in schema public
  revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;
