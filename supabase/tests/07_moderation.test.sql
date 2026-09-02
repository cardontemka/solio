-- Privileged operations check the caller's role in the database, so hiding a
-- button in the UI is convenience and never the control. docs/security.md §11
-- question 17: "Can a non-admin access admin endpoints?"

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

select plan(15);

select set_config('test.user',  pg_temp.login_as('altan@example.invalid')::text,     true);
select set_config('test.mod',   (select id::text from auth.users where email='mod_demo@example.invalid'),   true);
select set_config('test.admin', (select id::text from auth.users where email='admin_demo@example.invalid'), true);
select set_config('test.book',  (select id::text from public.books limit 1), true);
select set_config('test.report',(select id::text from public.reports limit 1), true);

-- ══ An ordinary user has no privileged access at all ══════════════════════
select throws_ok(
  $$ select public.moderate_entity('book', current_setting('test.book')::uuid, 'hidden') $$,
  '42501', null, 'a user cannot hide content');

select throws_ok(
  $$ select public.moderate_profile(current_setting('test.mod')::uuid, 'suspended') $$,
  '42501', null, 'a user cannot suspend an account');

select throws_ok(
  $$ select public.resolve_report(current_setting('test.report')::uuid, 'resolved') $$,
  '42501', null, 'a user cannot resolve a report');

select throws_ok(
  $$ select public.admin_set_role(current_setting('test.user')::uuid, 'admin', true) $$,
  '42501', null, 'a user cannot grant themselves a role');

set local role authenticated;
select is((select count(*)::int from public.reports
            where reporter_id <> current_setting('test.user')::uuid), 0,
  'a user cannot read other people''s reports');
reset role;

-- ══ A moderator can moderate content but not roles ════════════════════════
select pg_temp.login_as('mod_demo@example.invalid');

select lives_ok(
  $$ select public.moderate_entity('book', current_setting('test.book')::uuid,
                                   'hidden', 'test') $$,
  'a moderator can hide a book');

select is((select moderation_status::text from public.books
            where id = current_setting('test.book')::uuid),
  'hidden', 'the book is hidden, not deleted');

select lives_ok(
  $$ select public.resolve_report(current_setting('test.report')::uuid,
                                  'resolved', 'test') $$,
  'a moderator can resolve a report');

select throws_ok(
  $$ select public.admin_set_role(current_setting('test.user')::uuid, 'moderator', true) $$,
  '42501', null, 'a moderator cannot grant roles');

select throws_ok(
  $$ select public.moderate_profile(current_setting('test.admin')::uuid, 'suspended') $$,
  '42501', null, 'a moderator cannot suspend an admin');

-- ══ An admin can do both, but not to themselves ═══════════════════════════
select pg_temp.login_as('admin_demo@example.invalid');

select lives_ok(
  $$ select public.admin_set_role(current_setting('test.user')::uuid, 'moderator', true) $$,
  'an admin can grant a role');

select is((select count(*)::int from public.user_roles
            where user_id = current_setting('test.user')::uuid and role = 'moderator'),
  1, 'the role was actually granted');

select throws_ok(
  $$ select public.admin_set_role(current_setting('test.admin')::uuid, 'admin', false) $$,
  '23514', null, 'an admin cannot revoke their own role');

select throws_ok(
  $$ select public.moderate_profile(current_setting('test.admin')::uuid, 'suspended') $$,
  '23514', null, 'nobody can moderate themselves');

-- ══ Moderation is audited ═════════════════════════════════════════════════
select cmp_ok(
  (select count(*)::int from public.audit_logs
    where action like 'moderate.%' or action like 'report.%' or action like 'role.%'),
  '>=', 3,
  'every privileged action wrote an audit row');

select * from finish();
rollback;
