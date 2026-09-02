-- Reviews rate the WORK, not the transaction (ADR-022), and the unique
-- constraint is the rule: one voice per person per book.

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
-- A book Alice has NOT already reviewed in the seed, so the suite does not
-- depend on what the fixtures happen to contain.
select set_config('test.book',
  (select b.id::text from public.books b
    where not exists (select 1 from public.book_reviews r
                       where r.book_id = b.id
                         and r.user_id = current_setting('test.alice')::uuid)
    order by b.created_at limit 1), true);

set local role authenticated;

-- ══ Writing ═══════════════════════════════════════════════════════════════
select lives_ok(
  $$ insert into public.book_reviews (book_id, user_id, rating, body)
     values (current_setting('test.book')::uuid, current_setting('test.alice')::uuid,
             5, 'Сайн ном.') $$,
  'a signed-in user can review a book without having swapped it');

select throws_ok(
  $$ insert into public.book_reviews (book_id, user_id, rating)
     values (current_setting('test.book')::uuid, current_setting('test.alice')::uuid, 3) $$,
  '23505', null, 'a second review of the same book is refused');

select throws_ok(
  $$ insert into public.book_reviews (book_id, user_id, rating)
     values (current_setting('test.book')::uuid, current_setting('test.alice')::uuid, 9) $$,
  '23514', null, 'a rating outside 1..5 is refused');

select throws_ok(
  $$ insert into public.book_reviews (book_id, user_id, rating)
     values (current_setting('test.book')::uuid, current_setting('test.bob')::uuid, 1) $$,
  '42501', null, 'a user cannot review as somebody else');

select lives_ok(
  $$ update public.book_reviews set rating = 4, body = 'Дахин уншлаа.'
      where user_id = current_setting('test.alice')::uuid
        and book_id = current_setting('test.book')::uuid $$,
  'a user can revise their own review');

select throws_ok(
  $$ update public.book_reviews set moderation_status = 'hidden'
      where user_id = current_setting('test.alice')::uuid
        and book_id = current_setting('test.book')::uuid $$,
  '42501', null, 'a user cannot moderate their own review');

-- ══ Moderation ════════════════════════════════════════════════════════════
reset role;
select set_config('test.review',
  (select id::text from public.book_reviews
    where user_id = current_setting('test.alice')::uuid
      and book_id = current_setting('test.book')::uuid), true);

select pg_temp.login_as('mod_demo@example.invalid');
select lives_ok(
  $$ select public.moderate_entity('review', current_setting('test.review')::uuid, 'hidden') $$,
  'a moderator can hide a review');

-- A hidden review stays visible to its author, who would otherwise think it
-- had silently vanished, and to staff.
select pg_temp.login_as('bolor@example.invalid');
set local role authenticated;
select is((select count(*)::int from public.book_reviews
            where id = current_setting('test.review')::uuid),
  0, 'a hidden review is invisible to other readers');
reset role;

select pg_temp.login_as('altan@example.invalid');
set local role authenticated;
select is((select count(*)::int from public.book_reviews
            where id = current_setting('test.review')::uuid),
  1, 'its author can still see it');

select lives_ok(
  $$ delete from public.book_reviews where id = current_setting('test.review')::uuid $$,
  'a user can withdraw their own review');
reset role;

-- ══ The notifier is server-side only ══════════════════════════════════════
select ok(
  not has_function_privilege('authenticated', 'public.notify_review(uuid, uuid)', 'EXECUTE'),
  'notify_review cannot be called by a client — the recipient list is derived');

select * from finish();
rollback;
