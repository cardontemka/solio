-- books = the abstract work (unit of search, review, wishlist, SEO URL)
-- book_copies = one physical copy owned by one user (unit of ownership/swap)
-- Merging them would make ownership a property of a shared row.

create table public.books (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(btrim(title)) between 1 and 300),
  author            text check (author      is null or length(author)      <= 200),
  isbn              text check (isbn        is null or length(isbn)         <= 32),
  publisher         text check (publisher   is null or length(publisher)   <= 200),
  language          text check (language    is null or language ~ '^[a-z]{2}(-[A-Za-z]{2,8})*$'),
  description       text check (description is null or length(description) <= 8000),
  published_at      date check (published_at is null
                                or published_at <= (now() + interval '1 year')::date),
  created_by        uuid references public.profiles(id) on delete set null,
  moderation_status public.content_moderation_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  isbn_norm   text generated always as (public.solio_isbn_norm(isbn)) stored,
  title_norm  text generated always as (public.solio_norm(title))     stored,
  author_norm text generated always as (public.solio_norm(author))    stored,

  search_vector tsvector generated always as (
       setweight(to_tsvector('simple', public.solio_norm(title)),  'A')
    || setweight(to_tsvector('simple', public.solio_norm(coalesce(author,''))), 'B')
    || setweight(to_tsvector('simple',
         coalesce(public.solio_isbn_norm(isbn),'') || ' ' ||
         public.solio_norm(coalesce(publisher,''))), 'C')
    || setweight(to_tsvector('simple', public.solio_norm(coalesce(description,''))), 'D')
  ) stored
);

create unique index books_isbn_norm_key
  on public.books (isbn_norm) where isbn_norm is not null;
create index books_feed_keyset
  on public.books (moderation_status, created_at desc, id desc);
create index books_search_vector_idx on public.books using gin (search_vector);
create index books_title_trgm_idx  on public.books using gin (title_norm  extensions.gin_trgm_ops);
create index books_author_trgm_idx on public.books using gin (author_norm extensions.gin_trgm_ops);

create table public.book_copies (
  id                uuid primary key default gen_random_uuid(),
  book_id           uuid not null references public.books(id)    on delete restrict,
  owner_id          uuid not null references public.profiles(id) on delete restrict,
  -- Ownership and physical custody are different concepts. They coincide today,
  -- and this CHECK is the honest statement of that; Phase 2 drops just this line.
  custodian_id      uuid not null references public.profiles(id) on delete restrict,
  condition         public.book_condition not null,
  condition_note    text check (condition_note is null or length(condition_note) <= 1000),
  status            public.copy_status not null default 'available',
  moderation_status public.content_moderation_status not null default 'active',
  transfer_count    int not null default 0 check (transfer_count >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint book_copies_custody_follows_ownership check (custodian_id = owner_id)
);

create index book_copies_owner_idx on public.book_copies (owner_id, status);
create index book_copies_book_idx  on public.book_copies (book_id, status)
  where status = 'available';

-- ── Guard (review finding H3) ─────────────────────────────────────────────
-- Without this the owner could jump available→swapped, forge transfer_count,
-- set 'reserved' (a system-only transition) or undo a moderator's hide.
-- The copy state machine's final authority is here, not in the frontend.

create or replace function private.book_copies_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'BOOK_COPIES_ARE_NEVER_DELETED' using errcode = '42501',
      hint = 'Deactivate with status = ''inactive''.';
  end if;

  if not private.is_privileged_context() then
    if new.owner_id is distinct from old.owner_id
       or new.custodian_id is distinct from old.custodian_id then
      raise exception 'OWNERSHIP_CHANGE_FORBIDDEN' using errcode = '42501',
        hint = 'Ownership changes only through public.complete_swap().';
    end if;
    if new.book_id is distinct from old.book_id
       or new.created_at is distinct from old.created_at
       or new.transfer_count is distinct from old.transfer_count then
      raise exception 'COPY_IMMUTABLE_FIELD' using errcode = '23514';
    end if;
    if new.moderation_status is distinct from old.moderation_status then
      raise exception 'MODERATION_IS_STAFF_ONLY' using errcode = '42501';
    end if;
    -- Only these four owner-driven edges exist; everything else is system-only.
    if new.status is distinct from old.status
       and (old.status, new.status) not in
           (('available','inactive'), ('inactive','available'),
            ('swapped','available'),  ('swapped','inactive')) then
      raise exception 'INVALID_COPY_TRANSITION_%_TO_%', old.status, new.status
        using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger book_copies_guard_trg before update or delete on public.book_copies
  for each row execute function private.book_copies_guard();

create or replace function private.owns_copy(p_copy uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.book_copies
                      where id = p_copy and owner_id = (select auth.uid())) $$;
