-- The swap state machine is total: of the 30 ordered pairs of statuses,
-- exactly 6 are legal. docs/transactions.md §2.1-2.2.

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

select plan(11);

-- ── The edge table itself ─────────────────────────────────────────────────
select is(
  (select count(*)::int
     from unnest(array['REQUESTED','ACCEPTED','CONFIRMED','COMPLETED','REJECTED','CANCELLED']) a
    cross join unnest(array['REQUESTED','ACCEPTED','CONFIRMED','COMPLETED','REJECTED','CANCELLED']) b
    where private.is_valid_swap_edge(a, b)),
  6, 'exactly 6 of the 30 ordered status pairs are legal edges');

select ok(private.is_valid_swap_edge('REQUESTED','ACCEPTED'),  'REQUESTED -> ACCEPTED');
select ok(private.is_valid_swap_edge('ACCEPTED','CONFIRMED'),  'ACCEPTED -> CONFIRMED');
select ok(private.is_valid_swap_edge('CONFIRMED','COMPLETED'), 'CONFIRMED -> COMPLETED');

-- Once a handover is asserted, unilateral cancellation must be impossible.
select ok(not private.is_valid_swap_edge('CONFIRMED','CANCELLED'),
  'CONFIRMED -> CANCELLED is refused');
select ok(not private.is_valid_swap_edge('ACCEPTED','REJECTED'),
  'ACCEPTED -> REJECTED is refused (backing out after acceptance is CANCELLED)');

select is(
  (select count(*)::int
     from unnest(array['COMPLETED','REJECTED','CANCELLED']) terminal
    cross join unnest(array['REQUESTED','ACCEPTED','CONFIRMED','COMPLETED','REJECTED','CANCELLED']) any_status
    where private.is_valid_swap_edge(terminal, any_status)),
  0, 'no edge leaves a terminal status');

-- ── The guard enforces it on real rows ────────────────────────────────────
-- Runs as postgres, i.e. the privileged context the RPCs use: even there the
-- edge whitelist applies.
select throws_ok(
  $$ update public.swaps set status = 'COMPLETED'
      where status = 'REQUESTED' $$,
  '23514', null, 'the guard rejects REQUESTED -> COMPLETED even for postgres');

select throws_ok(
  $$ delete from public.swaps where true $$,
  '42501', null, 'swaps can never be deleted');

-- ── Two-party confirmation ────────────────────────────────────────────────
-- The first confirmer is recorded; the same person cannot also complete it.
select pg_temp.login_as('altan@example.invalid');
select lives_ok(
  $$ select public.complete_swap(
       (select id from public.swaps where status = 'ACCEPTED'
         and requester_id = (select auth.uid()) limit 1)) $$,
  'a participant can confirm handover (ACCEPTED -> CONFIRMED)');

select throws_ok(
  $$ select public.complete_swap(
       (select id from public.swaps where status = 'CONFIRMED'
         and confirmed_by = (select auth.uid()) limit 1)) $$,
  '23514', null,
  'the same participant cannot then complete it alone');

select * from finish();
rollback;
