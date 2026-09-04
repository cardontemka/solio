-- Business-critical history is append-only for every path the application can
-- reach. An operator holding the database password may remove rows — that is
-- the escape hatch of 20260902000160..180 — but nothing, including postgres,
-- may rewrite them in place. docs/database.md §6.

begin;
create extension if not exists pgtap with schema extensions;

create function pg_temp.login_as(p_email text) returns uuid
language plpgsql security definer as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  return v_id;
end $$;

select plan(13);

-- audit_logs is empty in a fresh seed, and a row-level trigger cannot fire on
-- zero rows — the test would pass for the wrong reason. Give it something to
-- bite on. (Inserting is allowed; only rewriting is not.)
insert into public.audit_logs (actor_id, action, entity_type, entity_id)
select id, 'test.fixture', 'profile', id::text from public.profiles limit 1;

-- Asserted relatively: the suite must not depend on how much history the
-- local database happens to hold.
select cmp_ok((select count(*)::int from public.audit_logs), '>=', 1,
  'at least one audit row exists, so the immutability checks are meaningful');

-- ══ Nobody rewrites history ═══════════════════════════════════════════════
-- These run as postgres — the most privileged connection there is. Deletion
-- is now permitted there; alteration is not, for anyone.

select throws_ok(
  $$ update public.ownership_events set to_owner_id = from_owner_id where true $$,
  '42501', null, 'ownership_events cannot be updated, even as postgres');

select throws_ok(
  $$ update public.audit_logs set action = 'tampered' where true $$,
  '42501', null, 'audit_logs cannot be updated, even as postgres');

-- ══ The application can delete none of it ═════════════════════════════════
-- authenticated is the role PostgREST assumes for a signed-in user, and the
-- one a stolen session reaches. service_role differs only in bypassing RLS,
-- which is not what stops it here.

select set_config('test.alice', pg_temp.login_as('altan@example.invalid')::text, true);
set local role authenticated;

select throws_ok(
  $$ delete from public.ownership_events where true $$,
  '42501', null, 'a signed-in user cannot delete ownership history');

select throws_ok(
  $$ delete from public.audit_logs where true $$,
  '42501', null, 'a signed-in user cannot delete audit rows');

-- Deleting a listing is the owner's to do (20260902000300). What a signed-in
-- user still cannot do is reach somebody else's: RLS narrows the statement to
-- their own rows, so this deletes only Altan's and leaves the rest standing.
select lives_ok(
  $$ delete from public.book_copies where true $$,
  'a signed-in user can delete their own listings');

select cmp_ok(
  (select count(*)::int from public.book_copies
    where owner_id <> current_setting('test.alice')::uuid), '>', 0,
  'and other people''s listings are untouched');

select is(
  (select count(*)::int from public.book_copies
    where owner_id = current_setting('test.alice')::uuid),
  0, 'only the caller''s own rows went');

select throws_ok(
  $$ truncate public.ownership_events $$,
  '42501', null, 'a signed-in user cannot truncate ownership history');

reset role;

-- Current state and the ledger must always agree. Checked before the operator
-- deletions below, which deliberately remove rows from both.
select is(
  (select count(*)::int
     from public.book_copies bc
     join lateral (select to_owner_id from public.ownership_events
                    where book_copy_id = bc.id order by id desc limit 1) last on true
    where bc.owner_id <> last.to_owner_id),
  0, 'every copy''s owner_id matches the latest ownership event');

-- ══ The operator can ══════════════════════════════════════════════════════
-- Reaching postgres means holding the database password or a Studio session.
-- Rolled back with the rest of the transaction.

select lives_ok(
  $$ delete from public.book_copies
      where id = (select id from public.book_copies order by created_at limit 1) $$,
  'an operator can delete a book copy');

select is(
  (select count(*)::int from public.ownership_events oe
     where not exists (select 1 from public.book_copies c where c.id = oe.book_copy_id)),
  0, 'deleting a copy takes its ownership events with it');

select lives_ok(
  $$ delete from public.audit_logs where true $$,
  'an operator can clear audit rows');

select * from finish();
rollback;
