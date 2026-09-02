-- Listing a book writes three rows that must agree: the work, the physical
-- copy, and the opening entry of that copy's ownership ledger.
-- docs/transactions.md, ADR-014.

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

select plan(9);

select set_config('test.alice', pg_temp.login_as('altan@example.invalid')::text, true);

select lives_ok(
  $$ select public.create_book_with_copy('pgTAP тест ном', 'Тест Зохиогч',
       '978-9997-00-111-2', null, 'mn', null, 2024, 'like_new', 'Шинэ шахуу.') $$,
  'a signed-in user can create a listing');

select is((select count(*)::int from public.books where title = 'pgTAP тест ном'), 1,
  'the work row was created');

select is(
  (select count(*)::int from public.book_copies c
     join public.books b on b.id = c.book_id
    where b.title = 'pgTAP тест ном'),
  1, 'exactly one copy was created');

-- Ownership comes from auth.uid(), never from anything the client sent.
select is(
  (select c.owner_id from public.book_copies c
     join public.books b on b.id = c.book_id where b.title = 'pgTAP тест ном'),
  current_setting('test.alice')::uuid,
  'the copy is owned by the caller, not by any client-supplied id');

select is(
  (select c.custodian_id from public.book_copies c
     join public.books b on b.id = c.book_id where b.title = 'pgTAP тест ном'),
  current_setting('test.alice')::uuid,
  'custodian follows ownership in the MVP');

select is(
  (select count(*)::int from public.ownership_events e
     join public.book_copies c on c.id = e.book_copy_id
     join public.books b on b.id = c.book_id
    where b.title = 'pgTAP тест ном' and e.event_type = 'initial_registration'
      and e.from_owner_id is null),
  1, 'the ledger opens with an initial_registration event');

select is(
  (select count(*)::int from public.audit_logs
    where action = 'book_copy.created'),
  1, 'the creation is audited');

-- A second listing of the same ISBN attaches to the existing work.
select pg_temp.login_as('bolor@example.invalid');
select public.create_book_with_copy('Өөр нэр, ижил ISBN', null,
  '9789997001112', null, 'mn', null, null, 'good', null);

select is((select count(*)::int from public.books where isbn_norm = '9789997001112'), 1,
  'the same ISBN reuses the existing work rather than duplicating it');

select is(
  (select count(*)::int from public.book_copies c
     join public.books b on b.id = c.book_id
    where b.isbn_norm = '9789997001112'),
  2, 'both copies aggregate under that one work');

select * from finish();
rollback;
