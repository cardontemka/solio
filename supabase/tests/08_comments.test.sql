-- Comments hang off the thing on screen — a listing or a request — never off a
-- shared catalogue row. One table, one set of rules, an exclusive arc to keep a
-- real foreign key to each parent (ADR-031).

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

select set_config('test.alice', pg_temp.login_as('altan@example.invalid')::text, true);
select set_config('test.bob',
  (select id::text from auth.users where email='bolor@example.invalid'), true);
-- A listing Alice does NOT own, so commenting is the ordinary case rather than
-- the owner talking to themselves.
select set_config('test.listing',
  (select id::text from public.book_copies
    where owner_id <> current_setting('test.alice')::uuid
      and status = 'available'
    order by created_at limit 1), true);

set local role authenticated;

-- ══ Writing ═══════════════════════════════════════════════════════════════
select lives_ok(
  $$ insert into public.comments (book_copy_id, user_id, body)
     values (current_setting('test.listing')::uuid, current_setting('test.alice')::uuid,
             'Сонирхож байна.') $$,
  'a signed-in user can comment on a listing');

select lives_ok(
  $$ insert into public.comments (book_copy_id, user_id, body)
     values (current_setting('test.listing')::uuid, current_setting('test.alice')::uuid,
             'Бас нэг зүйл нэмье.') $$,
  'the same person can comment again — there is no one-per-thread limit');

select throws_ok(
  $$ insert into public.comments (book_copy_id, user_id, body)
     values (current_setting('test.listing')::uuid, current_setting('test.alice')::uuid, '  ') $$,
  '23514', null, 'an empty comment is refused');

select throws_ok(
  $$ insert into public.comments (user_id, body)
     values (current_setting('test.alice')::uuid, 'Эцэггүй.') $$,
  '23514', null, 'a comment with no parent is refused');

select throws_ok(
  $$ insert into public.comments (book_copy_id, user_id, body)
     values (current_setting('test.listing')::uuid, current_setting('test.bob')::uuid, 'Би Болор.') $$,
  '42501', null, 'a user cannot comment as somebody else');

select lives_ok(
  $$ update public.comments set body = 'Дахин уншлаа.'
      where user_id = current_setting('test.alice')::uuid
        and book_copy_id = current_setting('test.listing')::uuid $$,
  'a user can revise their own comment');

select throws_ok(
  $$ update public.comments set moderation_status = 'hidden'
      where user_id = current_setting('test.alice')::uuid
        and book_copy_id = current_setting('test.listing')::uuid $$,
  '42501', null, 'a user cannot moderate their own comment');

select throws_ok(
  $$ update public.comments
        set book_copy_id = (select id from public.book_copies
                             where id <> current_setting('test.listing')::uuid limit 1)
      where user_id = current_setting('test.alice')::uuid $$,
  '42501', null, 'a comment cannot be moved to another listing');

-- ══ Moderation ════════════════════════════════════════════════════════════
reset role;
select set_config('test.comment',
  (select id::text from public.comments
    where user_id = current_setting('test.alice')::uuid
      and book_copy_id = current_setting('test.listing')::uuid
    order by created_at limit 1), true);

select pg_temp.login_as('mod_demo@example.invalid');
select lives_ok(
  $$ select public.moderate_entity('comment', current_setting('test.comment')::uuid, 'hidden') $$,
  'a moderator can hide a comment through the shared entry point');

select pg_temp.login_as('bolor@example.invalid');
set local role authenticated;
select is((select count(*)::int from public.comments
            where id = current_setting('test.comment')::uuid),
  0, 'a hidden comment is invisible to other readers');
reset role;

-- ══ The notifier is server-side only ══════════════════════════════════════
select ok(
  not has_function_privilege('authenticated', 'public.notify_comment(uuid, uuid)', 'EXECUTE'),
  'notify_comment cannot be called by a client — the recipient is derived');

select * from finish();
rollback;
