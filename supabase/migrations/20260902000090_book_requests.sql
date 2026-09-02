-- Wishlist and "this book isn't here yet" are one table.
--
-- Both are the same sentence: a user wants a book and should be told when a
-- copy of it appears. book_id NOT NULL = wishlist entry against a known work;
-- book_id NULL = free-text request matched by ISBN, then fuzzy title.
-- Two tables would duplicate the RLS set, the matcher and the "my wanted
-- books" view, and would run the matcher twice per new listing.

create domain public.request_status as text
  constraint request_status_values
  check (value in ('open','fulfilled','cancelled'));

create table public.book_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  book_id         uuid references public.books(id) on delete set null,
  title           text check (title  is null or length(btrim(title)) between 1 and 300),
  author          text check (author is null or length(author) <= 200),
  isbn            text check (isbn   is null or length(isbn)   <= 32),
  note            text check (note   is null or length(note)   <= 500),
  status          public.request_status not null default 'open',
  -- A match is not fulfilment: the request stays open until the user cancels
  -- or actually obtains the book. This only records what we found and notified.
  matched_book_id uuid references public.books(id) on delete set null,
  matched_at      timestamptz,
  created_at      timestamptz not null default now(),
  fulfilled_at    timestamptz,

  isbn_norm  text generated always as (public.solio_isbn_norm(isbn)) stored,
  title_norm text generated always as (public.solio_norm(coalesce(title,''))) stored,

  constraint book_requests_target check (book_id is not null or title is not null),
  constraint book_requests_fulfilled_stamp
    check ((status = 'fulfilled') = (fulfilled_at is not null)),
  constraint book_requests_matched_stamp
    check ((matched_book_id is not null) = (matched_at is not null))
);

create index book_requests_user_idx on public.book_requests (user_id, status, created_at desc);
create index book_requests_isbn_idx on public.book_requests (isbn_norm) where status = 'open';
create index book_requests_book_idx on public.book_requests (book_id)   where status = 'open';
create index book_requests_title_trgm_idx
  on public.book_requests using gin (title_norm extensions.gin_trgm_ops);

-- One open request per user per known book.
create unique index book_requests_no_dup
  on public.book_requests (user_id, book_id) where book_id is not null and status = 'open';

-- One wishlist_match notification per user per book, ever. Makes the matcher
-- idempotent: adding a second copy of the same book re-runs it harmlessly.
create unique index notifications_wishlist_once
  on public.notifications (user_id, entity_id) where type = 'wishlist_match';

-- ── Guard ─────────────────────────────────────────────────────────────────
-- The owner may edit their own wording and cancel, but not forge a match or
-- back-date the row.
create or replace function private.book_requests_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;   -- deleting your own wishlist row carries no history
  end if;
  if not private.is_privileged_context() then
    if new.user_id is distinct from old.user_id
       or new.created_at is distinct from old.created_at
       or new.matched_book_id is distinct from old.matched_book_id
       or new.matched_at is distinct from old.matched_at then
      raise exception 'REQUEST_IMMUTABLE_FIELD' using errcode = '42501';
    end if;
    if new.status not in ('open','cancelled') then
      raise exception 'REQUEST_STATUS_NOT_SETTABLE' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger book_requests_guard_trg before update or delete on public.book_requests
  for each row execute function private.book_requests_guard();

-- ── Rate limit ────────────────────────────────────────────────────────────
-- Counting the rows being created, evaluated inside the RLS WITH CHECK, so it
-- cannot be bypassed by calling PostgREST directly. NOT the only protection:
-- Cloudflare rate rules sit in front (docs/security.md §8).
create or replace function private.request_rate_ok()
returns boolean language sql stable security definer set search_path = ''
as $$
  select count(*) < 50 from public.book_requests
   where user_id = (select auth.uid()) and created_at > now() - interval '24 hours'
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────
-- A wishlist is private: only its owner and staff can read it.
alter table public.book_requests enable row level security;
grant select, insert, update, delete on public.book_requests to authenticated;

create policy book_requests_select_own on public.book_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_staff());

create policy book_requests_insert_own on public.book_requests
  for insert to authenticated
  with check (user_id = (select auth.uid())
              and private.is_active_account()
              and private.request_rate_ok());

create policy book_requests_update_own on public.book_requests
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy book_requests_delete_own on public.book_requests
  for delete to authenticated
  using (user_id = (select auth.uid()));
