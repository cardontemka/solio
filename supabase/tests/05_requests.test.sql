-- A request is a post: publicly readable, answered by ordinary comments, and
-- rate-limited. There is no matcher — announcing "your book appeared" was the
-- old wishlist and it is gone (ADR-032).

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

select plan(10);

select set_config('test.alice', pg_temp.login_as('altan@example.invalid')::text, true);
select set_config('test.bob',
  (select id::text from auth.users where email='bolor@example.invalid'), true);

-- ══ Posting ═══════════════════════════════════════════════════════════════
set local role authenticated;

select lives_ok(
  $$ insert into public.book_requests (user_id, title, author, note)
     values (current_setting('test.alice')::uuid, 'Дүрмийн ном', 'Тодорхойгүй',
             'Аль ч хэвлэл болно.') $$,
  'a signed-in user can post a request');

select throws_ok(
  $$ insert into public.book_requests (user_id, title)
     values (current_setting('test.alice')::uuid, '   ') $$,
  '23514', null, 'a request with no readable title is refused');

select throws_ok(
  $$ insert into public.book_requests (user_id, title)
     values (current_setting('test.bob')::uuid, 'Би Болор.') $$,
  '42501', null, 'a user cannot post as somebody else');

reset role;
select set_config('test.request',
  (select id::text from public.book_requests
    where user_id = current_setting('test.alice')::uuid
      and title = 'Дүрмийн ном'), true);

-- ══ Anyone may read it ════════════════════════════════════════════════════
-- A post nobody else can see cannot be answered, which was the flaw in the
-- private wishlist it replaces.
select pg_temp.login_as('bolor@example.invalid');
set local role authenticated;
select is((select count(*)::int from public.book_requests
            where id = current_setting('test.request')::uuid),
  1, 'another signed-in user can read the post');

-- ══ Answering ═════════════════════════════════════════════════════════════
select lives_ok(
  $$ insert into public.comments (request_id, user_id, body)
     values (current_setting('test.request')::uuid, current_setting('test.bob')::uuid,
             'Надад байна, солилцъё.') $$,
  'anyone signed in can answer a request');

select throws_ok(
  $$ insert into public.comments (request_id, book_copy_id, user_id, body)
     values (current_setting('test.request')::uuid,
             (select id from public.book_copies limit 1),
             current_setting('test.bob')::uuid, 'Хоёр эцэгтэй.') $$,
  '23514', null, 'a comment cannot belong to a listing and a request at once');

-- RLS narrows the UPDATE rather than raising: the statement succeeds and
-- touches nothing, which is why the status is what the assertion looks at.
select lives_ok(
  $$ update public.book_requests set status = 'cancelled'
      where id = current_setting('test.request')::uuid $$,
  'a non-owner''s close attempt is silently scoped to zero rows');

select is(
  (select status::text from public.book_requests
    where id = current_setting('test.request')::uuid),
  'open', 'and the post is still open — only its author can close it');
reset role;

-- ══ Cancelling hides it from everyone but its author ══════════════════════
select pg_temp.login_as('altan@example.invalid');
set local role authenticated;
select lives_ok(
  $$ update public.book_requests set status = 'cancelled'
      where id = current_setting('test.request')::uuid $$,
  'the poster can cancel their own request');
reset role;

select pg_temp.login_as('bolor@example.invalid');
set local role authenticated;
select is((select count(*)::int from public.book_requests
            where id = current_setting('test.request')::uuid),
  0, 'a cancelled post is invisible to other readers');
reset role;

select * from finish();
rollback;
