-- Row Level Security + explicit grants.
--
-- GRANT and POLICY are two separate checks: a policy that permits a row is
-- irrelevant without the privilege, and vice versa. Both are set deliberately.
--
-- auth.uid() is always wrapped as (select auth.uid()) so PostgreSQL evaluates
-- it once as an InitPlan instead of once per row.

alter table public.profiles         enable row level security;
alter table public.user_roles       enable row level security;
alter table public.user_roles       force  row level security;
alter table public.books            enable row level security;
alter table public.book_copies      enable row level security;
alter table public.ownership_events enable row level security;
alter table public.ownership_events force  row level security;
alter table public.audit_logs       enable row level security;
alter table public.audit_logs       force  row level security;

-- Close everything Supabase opened by default (review finding H1), then grant
-- back exactly what each role needs — never TRUNCATE/REFERENCES/TRIGGER.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select         on public.profiles         to anon, authenticated;
grant update         on public.profiles         to authenticated;
grant select         on public.user_roles       to authenticated;
grant select         on public.books            to anon, authenticated;
grant select         on public.book_copies      to anon, authenticated;
grant update         on public.book_copies      to authenticated;
grant select         on public.ownership_events to authenticated;
grant select         on public.audit_logs       to authenticated;
-- books/book_copies INSERT is intentionally absent: creation goes through
-- public.create_book_with_copy() so both rows and the ledger entry are atomic.

-- ── profiles ──────────────────────────────────────────────────────────────
create policy profiles_select_public on public.profiles
  for select to anon, authenticated using (true);
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ── user_roles: readable, never writable from the client ──────────────────
create policy user_roles_select_self on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_staff());

-- ── books ─────────────────────────────────────────────────────────────────
create policy books_select_public on public.books
  for select to anon, authenticated
  using (moderation_status = 'active' or private.is_staff());

-- ── book_copies ───────────────────────────────────────────────────────────
create policy book_copies_select_public on public.book_copies
  for select to anon, authenticated
  using (moderation_status = 'active'
         or owner_id = (select auth.uid())
         or private.is_staff());

-- The guard trigger restricts WHICH columns and transitions are legal; this
-- policy restricts WHOSE rows are reachable at all.
create policy book_copies_update_own on public.book_copies
  for update to authenticated
  using      (owner_id = (select auth.uid()) or private.is_staff())
  with check (owner_id = (select auth.uid()) or private.is_staff());

-- ── history ───────────────────────────────────────────────────────────────
-- Ownership history is community trust surface: readable, never writable.
create policy ownership_events_select on public.ownership_events
  for select to authenticated using (true);

create policy audit_logs_select_staff on public.audit_logs
  for select to authenticated using (private.is_staff());
