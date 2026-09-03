-- The audit questions from docs/security.md §11, as executable tests.
-- Each must answer "no". A regression here fails the build.

begin;
create extension if not exists pgtap with schema extensions;

-- Impersonate a signed-in user: RLS reads auth.uid() from this claim.
create function pg_temp.login_as(p_email text) returns uuid
language plpgsql security definer as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  return v_id;
end $$;

create function pg_temp.uid(p_email text) returns uuid
language sql security definer as $$ select id from auth.users where email = p_email $$;

-- A data-modifying CTE cannot sit inside a scalar subquery, so the row count
-- of a blocked write is measured here instead.
create function pg_temp.rows_updated_note(p_copy uuid) returns int
language plpgsql as $$
declare n int;
begin
  update public.book_copies set condition_note = 'HACKED' where id = p_copy;
  get diagnostics n = row_count;
  return n;
end $$;

create function pg_temp.rows_updated_status(p_copy uuid) returns int
language plpgsql as $$
declare n int;
begin
  update public.book_copies set status = 'inactive' where id = p_copy;
  get diagnostics n = row_count;
  return n;
end $$;

select plan(16);

select set_config('test.alice',   pg_temp.uid('altan@example.invalid')::text,  true),
       set_config('test.mallory', pg_temp.uid('ganbat@example.invalid')::text, true),
       set_config('test.alice_copy',
                  (select c.id::text from public.book_copies c
                    where c.owner_id = pg_temp.uid('altan@example.invalid')
                      and c.status = 'available' limit 1), true);

-- ══ Can A read B's email? ═════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and column_name in ('email','phone')),
  0, 'public schema exposes no email/phone column at all');

select ok(
  not has_table_privilege('authenticated', 'auth.users', 'SELECT'),
  'authenticated cannot select from auth.users');

-- ══ Cross-user writes ═════════════════════════════════════════════════════
select pg_temp.login_as('ganbat@example.invalid');
set local role authenticated;

select is(pg_temp.rows_updated_note(current_setting('test.alice_copy')::uuid), 0,
  'a third party cannot edit another user''s copy');

select is(pg_temp.rows_updated_status(current_setting('test.alice_copy')::uuid), 0,
  'a third party cannot change another user''s copy status');

select throws_ok(
  $$ insert into public.ownership_events (book_copy_id, from_owner_id, to_owner_id, event_type)
     values (current_setting('test.alice_copy')::uuid,
             current_setting('test.alice')::uuid,
             current_setting('test.mallory')::uuid, 'admin_correction') $$,
  '42501', null, 'a user cannot forge an ownership event');

select throws_ok(
  $$ insert into public.user_roles (user_id, role)
     values (current_setting('test.mallory')::uuid, 'admin') $$,
  '42501', null, 'a user cannot grant themselves admin');

select throws_ok(
  $$ insert into public.books (title) values ('direct insert') $$,
  '42501', null, 'books cannot be inserted directly — creation goes through the RPC');

select throws_ok(
  $$ update public.swaps set status = 'CANCELLED'
      where id = (select id from public.swaps limit 1) $$,
  '42501', null, 'swaps cannot be written directly — only through the RPCs');

-- ══ Suspension cannot be self-lifted ══════════════════════════════════════
select throws_ok(
  $$ update public.profiles set account_status = 'suspended'
      where id = current_setting('test.mallory')::uuid $$,
  '42501', null, 'a user cannot change their own account_status');

select lives_ok(
  $$ update public.profiles set bio = 'legitimate edit'
      where id = current_setting('test.mallory')::uuid $$,
  'a user CAN still edit their own bio');

-- ══ Other people's private data ═══════════════════════════════════════════
reset role;
insert into public.book_requests (user_id, title)
values (current_setting('test.alice')::uuid, 'Alice private wish');

select pg_temp.login_as('ganbat@example.invalid');
set local role authenticated;

-- A request is a post now, so a third party SHOULD see it — a post nobody can
-- read cannot be answered (ADR-032). What stays hidden is a cancelled one.
select is((select count(*)::int from public.book_requests
            where title = 'Alice private wish'), 1,
  'a third party can read another user''s open request post');

select is((select count(*)::int from public.notifications
            where user_id = current_setting('test.alice')::uuid), 0,
  'a third party cannot read another user''s notifications');

select is((select count(*)::int from public.audit_logs), 0,
  'a non-staff user cannot read audit_logs');

select is((select count(*)::int from public.swaps
            where requester_id <> current_setting('test.mallory')::uuid
              and responder_id <> current_setting('test.mallory')::uuid), 0,
  'a non-participant cannot see other people''s swaps');

-- ══ Grants and function hardening (review findings H1, ADR-014) ═══════════
reset role;

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public'
      and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')
      and grantee in ('anon','authenticated')),
  0, 'anon/authenticated hold no TRUNCATE, REFERENCES or TRIGGER grant anywhere');

select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('public','private')
      and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'),
  0, 'every SECURITY DEFINER function pins search_path');

select * from finish();
rollback;
