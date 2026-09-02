-- When a listing appears, open wishlist requests are matched and their owners
-- notified — exactly once, and never for the lister's own listing.

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

select plan(8);

select set_config('test.alice', pg_temp.login_as('altan@example.invalid')::text, true);

-- Alice wants two books nobody has listed yet.
insert into public.book_requests (user_id, title, author)
values (current_setting('test.alice')::uuid, 'Хагарсан толь', 'Д. Норов');
insert into public.book_requests (user_id, title, isbn)
values (current_setting('test.alice')::uuid, 'Дүрмийн ном', '978-9997-55-441-9');

-- ── Fuzzy title match ─────────────────────────────────────────────────────
select pg_temp.login_as('ganbat@example.invalid');
select public.create_book_with_copy('Хагарсан толь', 'Д. Норов',
  null, null, 'mn', null, null, 'good', null);

select is(
  (select count(*)::int from public.notifications
    where user_id = current_setting('test.alice')::uuid and type = 'wishlist_match'),
  1, 'a fuzzy title match notifies the requester');

select isnt(
  (select matched_book_id from public.book_requests
    where title = 'Хагарсан толь'),
  null, 'the request records which book matched');

select is(
  (select status::text from public.book_requests where title = 'Хагарсан толь'),
  'open', 'a match is not fulfilment — the request stays open');

-- ── ISBN match ────────────────────────────────────────────────────────────
select public.create_book_with_copy('Огт өөр нэртэй ном', null,
  '9789997554419', null, 'mn', null, null, 'new', null);

select is(
  (select count(*)::int from public.notifications
    where user_id = current_setting('test.alice')::uuid and type = 'wishlist_match'),
  2, 'an ISBN match notifies even when the title differs completely');

-- ── Idempotence ───────────────────────────────────────────────────────────
select pg_temp.login_as('bolor@example.invalid');
select public.create_book_with_copy('Хагарсан толь', 'Д. Норов',
  null, null, 'mn', null, null, 'fair', null);

select is(
  (select count(*)::int from public.notifications
    where user_id = current_setting('test.alice')::uuid and type = 'wishlist_match'),
  2, 'a second copy of an already-matched book does not notify again');

-- ── Never notify yourself ─────────────────────────────────────────────────
select pg_temp.login_as('altan@example.invalid');
insert into public.book_requests (user_id, title)
values (current_setting('test.alice')::uuid, 'Миний өөрийн ном');
select public.create_book_with_copy('Миний өөрийн ном', null,
  null, null, 'mn', null, null, 'good', null);

select is(
  (select count(*)::int from public.notifications
    where user_id = current_setting('test.alice')::uuid and type = 'wishlist_match'),
  2, 'listing a book you wished for does not notify you about yourself');

-- ── The request owner controls their own row, but not the match ───────────
set local role authenticated;

select throws_ok(
  $$ update public.book_requests
        set matched_book_id = (select id from public.books limit 1),
            matched_at = now()
      where user_id = current_setting('test.alice')::uuid $$,
  '42501', null, 'a user cannot forge a match on their own request');

select throws_ok(
  $$ update public.book_requests set status = 'fulfilled', fulfilled_at = now()
      where user_id = current_setting('test.alice')::uuid $$,
  '42501', null, 'a user cannot mark their own request fulfilled');

select * from finish();
rollback;
