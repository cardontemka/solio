-- Three changes that follow from dropping the "abstract work" framing.
--
-- 1. Ratings go. A rating measures a work; this site lists one person's copy,
--    so a 1–5 score on it says nothing useful. What is left is an ordinary
--    comment thread, which means the one-per-person constraint goes too:
--    people talk more than once.
--
-- 2. Usernames become readable. handle_new_user always appended 8 hex
--    characters, so every account got cart0n86dd2cc3 even when `cart0n` was
--    free. That was invisible while usernames were internal; /u/<username> is
--    now a public, shareable address. The suffix is now a collision fallback,
--    not the default.
--
-- 3. Profiles become searchable, so the search box can find people as well as
--    books.

-- ── 1. Comments, not reviews ──────────────────────────────────────────────
alter table public.book_reviews drop constraint book_reviews_one_per_user_book;
alter table public.book_reviews drop column rating;

comment on table public.book_reviews is
  'Plain comments on a book. Named book_reviews for historical reasons; there '
  'is no rating and no one-per-person limit (20260902000240).';

-- A comment with neither text nor a rating would be an empty row.
alter table public.book_reviews
  add constraint book_reviews_body_required
  check (body is not null and length(btrim(body)) between 1 and 4000);

-- ── 2. Readable usernames ─────────────────────────────────────────────────
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_base text;
  v_username text;
  v_try int := 0;
begin
  v_base := nullif(regexp_replace(lower(coalesce(new.raw_user_meta_data->>'username',
                                                 split_part(new.email,'@',1))),
                                  '[^a-z0-9_]', '', 'g'), '');
  v_base := left(coalesce(v_base, 'user'), 20);
  -- The column requires 3–24 characters; a one-letter mail prefix would fail.
  if length(v_base) < 3 then
    v_base := v_base || 'user';
  end if;

  v_username := v_base;
  while exists (select 1 from public.profiles where lower(username) = lower(v_username)) loop
    v_try := v_try + 1;
    if v_try > 99 then
      -- Give up being pretty rather than loop forever.
      v_username := left(v_base, 15) || substr(replace(new.id::text, '-', ''), 1, 8);
      exit;
    end if;
    v_username := v_base || v_try::text;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username,
          coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'),''), 'Шинэ хэрэглэгч'));

  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end $$;

-- ── 3. Searchable profiles ────────────────────────────────────────────────
alter table public.profiles
  add column if not exists username_norm text
    generated always as (public.solio_norm(username)) stored,
  add column if not exists display_name_norm text
    generated always as (public.solio_norm(display_name)) stored;

create index if not exists profiles_username_trgm_idx
  on public.profiles using gin (username_norm extensions.gin_trgm_ops);
create index if not exists profiles_display_name_trgm_idx
  on public.profiles using gin (display_name_norm extensions.gin_trgm_ops);

-- Listings are read straight from book_copies now, so the feed and search both
-- filter on (status, moderation_status) ordered by recency.
create index if not exists book_copies_feed_idx
  on public.book_copies (status, moderation_status, created_at desc, id desc);
