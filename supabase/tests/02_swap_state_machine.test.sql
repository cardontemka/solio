-- The swap state machine is total: of the 30 ordered pairs of statuses,
-- exactly 7 are legal. docs/transactions.md §2.1-2.2.

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

select plan(14);

-- ── The edge table itself ─────────────────────────────────────────────────
select is(
  (select count(*)::int
     from unnest(array['REQUESTED','ACCEPTED','CONFIRMED','COMPLETED','REJECTED','CANCELLED']) a
    cross join unnest(array['REQUESTED','ACCEPTED','CONFIRMED','COMPLETED','REJECTED','CANCELLED']) b
    where private.is_valid_swap_edge(a, b)),
  7, 'exactly 7 of the 30 ordered status pairs are legal edges');

select ok(private.is_valid_swap_edge('REQUESTED','ACCEPTED'),  'REQUESTED -> ACCEPTED');
select ok(private.is_valid_swap_edge('ACCEPTED','CONFIRMED'),  'ACCEPTED -> CONFIRMED');
select ok(private.is_valid_swap_edge('CONFIRMED','COMPLETED'), 'CONFIRMED -> COMPLETED');

-- A confirmed swap can be cancelled, but only by the person who confirmed it or
-- once it can no longer be carried out at all. The edge table says the move
-- exists; who may make it is respond_to_swap's business, and the last test in
-- this file is the one that holds that line.
select ok(private.is_valid_swap_edge('CONFIRMED','CANCELLED'),
  'CONFIRMED -> CANCELLED exists as an edge');
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

-- A participant is the most privileged non-operator who could want a swap
-- gone; the Data API must still refuse. (An operator with the database
-- password can delete — see 03_immutability.)
select pg_temp.login_as('altan@example.invalid');
set local role authenticated;
select throws_ok(
  $$ delete from public.swaps where true $$,
  '42501', null, 'a participant cannot delete a swap through the Data API');
reset role;

-- ── Two-party confirmation ────────────────────────────────────────────────
-- A handover is asserted by scanning the label on the book that was just put
-- into your hands, never by knowing a swap's id. The seeded ACCEPTED swap has
-- altan offering one copy and receiving the other; both codes are read out
-- here so each test can say which book is being scanned.
select set_config('test.swap', '7a1c93e4-5d2b-4f18-9c60-3e8b1d47a202', true);

select set_config('test.receives',
  (select c.public_code from public.swap_items si
     join public.book_copies c on c.id = si.book_copy_id
    where si.swap_id = current_setting('test.swap')::uuid
      and si.side = 'requested'), true),
  set_config('test.gives_away',
  (select c.public_code from public.swap_items si
     join public.book_copies c on c.id = si.book_copy_id
    where si.swap_id = current_setting('test.swap')::uuid
      and si.side = 'offered'), true);

select hasnt_function('public', 'complete_swap', array['uuid'],
  'a swap can no longer be advanced by id alone');

select pg_temp.login_as('altan@example.invalid');

-- Scanning the book you are giving away proves nothing: you are holding it
-- because you always were.
select throws_ok(
  format($$ select public.confirm_receipt_by_code(%L) $$,
         current_setting('test.gives_away')),
  '42501', null,
  'scanning your own offered copy is not a confirmation');

select lives_ok(
  format($$ select public.confirm_receipt_by_code(%L) $$,
         current_setting('test.receives')),
  'the receiving side confirms by scanning what it received (ACCEPTED -> CONFIRMED)');

select throws_ok(
  format($$ select public.confirm_receipt_by_code(%L) $$,
         current_setting('test.receives')),
  '23514', null,
  'the same participant cannot then complete it alone');

-- The rule the edge table used to carry: the other side confirmed, you changed
-- your mind, and the swap is still perfectly possible — so you may not walk.
select pg_temp.login_as('ganbat@example.invalid');
select throws_ok(
  format($$ select public.respond_to_swap(%L, 'cancel') $$,
         current_setting('test.swap')),
  '42501', null,
  'a participant cannot cancel out of a swap the other side confirmed');

select * from finish();
rollback;
