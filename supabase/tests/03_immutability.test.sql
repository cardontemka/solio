-- Business-critical history is append-only. Enforced by triggers rather than
-- RLS alone, because postgres and service_role carry BYPASSRLS.
-- docs/database.md §6.

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- audit_logs is empty in a fresh seed, and a row-level trigger cannot fire on
-- zero rows — the test would pass for the wrong reason. Give it something to
-- bite on. (Inserting is allowed; only rewriting is not.)
insert into public.audit_logs (actor_id, action, entity_type, entity_id)
select id, 'test.fixture', 'profile', id::text from public.profiles limit 1;

-- Asserted relatively: the suite must not depend on how much history the
-- local database happens to hold.
select cmp_ok((select count(*)::int from public.audit_logs), '>=', 1,
  'at least one audit row exists, so the immutability checks are meaningful');

-- These run as postgres — the most privileged connection the app ever uses.
select throws_ok(
  $$ update public.ownership_events set to_owner_id = from_owner_id where true $$,
  '42501', null, 'ownership_events cannot be updated, even as postgres');

select throws_ok(
  $$ delete from public.ownership_events where true $$,
  '42501', null, 'ownership_events cannot be deleted, even as postgres');

select throws_ok(
  $$ truncate public.ownership_events $$,
  '42501', null, 'ownership_events cannot be truncated');

select throws_ok(
  $$ update public.audit_logs set action = 'tampered' where true $$,
  '42501', null, 'audit_logs cannot be updated');

select throws_ok(
  $$ truncate public.audit_logs $$,
  '42501', null, 'audit_logs cannot be truncated');

select throws_ok(
  $$ delete from public.book_copies where true $$,
  '42501', null, 'book copies are never hard-deleted');

-- Current state and the ledger must always agree.
select is(
  (select count(*)::int
     from public.book_copies bc
     join lateral (select to_owner_id from public.ownership_events
                    where book_copy_id = bc.id order by id desc limit 1) last on true
    where bc.owner_id <> last.to_owner_id),
  0, 'every copy''s owner_id matches the latest ownership event');

select * from finish();
rollback;
