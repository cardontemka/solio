-- Reports and moderation.
--
-- Content is never destroyed by a moderator: books, copies, images and reviews
-- carry a moderation_status, and profiles an account_status. Every privileged
-- action writes an audit row — including the ones that are refused, because a
-- log that records only successes cannot answer "did anyone try?".

create domain public.report_status as text
  constraint report_status_values
  check (value in ('open','reviewing','resolved','dismissed'));

create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references public.profiles(id) on delete restrict,
  entity_type     text not null check (entity_type in
                    ('book','book_copy','review','profile','swap')),
  entity_id       uuid not null,
  reason          text not null check (reason in
                    ('spam','inappropriate','counterfeit','wrong_metadata',
                     'harassment','other')),
  detail          text check (detail is null or length(detail) <= 2000),
  status          public.report_status not null default 'open',
  resolution_note text check (resolution_note is null or length(resolution_note) <= 2000),
  resolved_by     uuid references public.profiles(id) on delete restrict,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),

  constraint reports_resolved_stamp
    check ((status in ('resolved','dismissed')) = (resolved_at is not null))
);

create index reports_status_idx on public.reports (status, created_at desc);
create index reports_entity_idx on public.reports (entity_type, entity_id);

-- One open report per person per target: stops a single user flooding the queue.
create unique index reports_one_open_per_target
  on public.reports (reporter_id, entity_type, entity_id)
  where status in ('open','reviewing');

-- Reporters describe; only staff judge.
create or replace function private.reports_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'REPORTS_ARE_NOT_DELETED' using errcode = '42501';
  end if;
  if not private.is_privileged_context() then
    raise exception 'REPORTS_ARE_RESOLVED_BY_STAFF' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger reports_guard_trg before update or delete on public.reports
  for each row execute function private.reports_guard();

alter table public.reports enable row level security;
grant select, insert on public.reports to authenticated;

-- A reporter can see what they filed; staff see the whole queue.
create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or private.is_staff());

-- SECURITY DEFINER, because a policy on a table may not read that same table
-- inline: PostgreSQL detects the loop and raises 42P17 for every write.
create or replace function private.report_rate_ok()
returns boolean language sql stable security definer set search_path = ''
as $$
  select count(*) < 10 from public.reports
   where reporter_id = (select auth.uid())
     and created_at > now() - interval '1 hour'
$$;

create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid())
              and private.is_active_account()
              and private.report_rate_ok());

-- ── Staff read access to the rest of the system ───────────────────────────
-- Moderators need to see hidden content to judge it; the existing policies
-- already allow that through private.is_staff(). Swaps and audit logs get it
-- here so the admin panel can inspect them.
create policy swaps_select_staff on public.swaps
  for select to authenticated using (private.is_staff());

create policy swap_items_select_staff on public.swap_items
  for select to authenticated using (private.is_staff());

create policy book_requests_select_staff on public.book_requests
  for select to authenticated using (private.is_staff());
