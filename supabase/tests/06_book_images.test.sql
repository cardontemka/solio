-- Image metadata is server-owned. The owner may reorder and remove; only the
-- server may publish, because publishing is what makes bytes public and the
-- server is the only party that has actually inspected them. (Review H4.)

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

select plan(12);

select set_config('test.alice', pg_temp.login_as('altan@example.invalid')::text, true);
select set_config('test.copy',
  (select id::text from public.book_copies
    where owner_id = current_setting('test.alice')::uuid limit 1), true);

-- ── The upload intent ─────────────────────────────────────────────────────
select lives_ok(
  $$ select public.create_image_upload_intent(
       current_setting('test.copy')::uuid, 'image/png', 50000, 'local') $$,
  'the owner can request an upload target');

-- Pick the row the intent above just created, not whatever the local database
-- happened to hold already.
select set_config('test.image',
  (select id::text from public.book_images
    where book_copy_id = current_setting('test.copy')::uuid
      and status = 'pending'
    order by created_at desc limit 1), true);

select is((select status::text from public.book_images
            where id = current_setting('test.image')::uuid),
  'pending', 'a fresh image is pending, never publicly visible');

select matches(
  (select storage_key from public.book_images where id = current_setting('test.image')::uuid),
  '^copies/[0-9a-f-]{36}/[0-9a-f-]{36}\.png$',
  'the key is server-generated from the copy id and a fresh uuid');

select throws_ok(
  $$ select public.create_image_upload_intent(
       current_setting('test.copy')::uuid, 'image/gif', 50000, 'local') $$,
  '23514', null, 'an unsupported MIME type is refused');

-- Someone else's copy is not yours to attach images to.
select pg_temp.login_as('bolor@example.invalid');
select throws_ok(
  $$ select public.create_image_upload_intent(
       current_setting('test.copy')::uuid, 'image/png', 50000, 'local') $$,
  '42501', null, 'a user cannot attach images to another user''s copy');

select throws_ok(
  $$ select public.publish_image(current_setting('test.image')::uuid, 400, 600, 50000) $$,
  '42501', null, 'a user cannot publish another user''s pending image');

-- ── The guard, as the owner ───────────────────────────────────────────────
select pg_temp.login_as('altan@example.invalid');
set local role authenticated;

select throws_ok(
  $$ update public.book_images set status = 'ready'
      where id = current_setting('test.image')::uuid $$,
  '42501', null,
  'the owner cannot publish an image themselves, skipping byte verification');

select throws_ok(
  $$ update public.book_images set byte_size = 999999
      where id = current_setting('test.image')::uuid $$,
  '42501', null, 'the owner cannot rewrite image metadata');

select throws_ok(
  $$ update public.book_images
        set storage_key = 'copies/00000000-0000-0000-0000-000000000000/'
                       || '00000000-0000-0000-0000-000000000000.png'
      where id = current_setting('test.image')::uuid $$,
  '42501', null, 'the owner cannot repoint an image at another object');

select throws_ok(
  $$ delete from public.book_images where id = current_setting('test.image')::uuid $$,
  '42501', null, 'images are soft-deleted, never dropped');

select lives_ok(
  $$ update public.book_images set sort_order = 3
      where id = current_setting('test.image')::uuid $$,
  'the owner CAN reorder their own images');

select lives_ok(
  $$ update public.book_images set status = 'removed'
      where id = current_setting('test.image')::uuid $$,
  'the owner CAN remove their own image');

select * from finish();
rollback;
