-- Three changes that belong together, because they all concern what a `books`
-- row means.
--
-- 1. A book gets *several* categories. One slot forced a choice nobody should
--    have to make — a history of Mongolian art is both — and the filter is more
--    useful when a book appears under every heading that fits. The list of
--    headings grows at the same time; twelve was coarse enough that most things
--    landed in "бусад".
--
-- 2. Two people listing the same book stop creating two catalogue rows. The
--    schema always said `books` is the work and `book_copies` is the physical
--    object (ADR-001); until now the create path ignored that and inserted a
--    fresh work every time. The add form can now offer "энэ ном биш биз?" and
--    attach the new copy to the row that already exists.
--
-- 3. A shared row must never be edited out from under the people sharing it.
--    So an edit that diverges forks: the copy gets a private row carrying the
--    changes, everyone else keeps theirs. That is the whole rule — no ownership
--    on catalogue rows, no locking, no merge conflicts.
--
-- 4. A report tells the staff about itself. It was landing in a table nobody was
--    watching.

-- ── 1. The category list ──────────────────────────────────────────────────

alter domain public.book_category drop constraint book_category_values;
alter domain public.book_category add constraint book_category_values
  check (value in (
    -- Уран зохиол ба түүний хэлбэрүүд
    'fiction',      -- уран зохиол
    'classic',      -- классик
    'poetry',       -- яруу найраг
    'drama',        -- драм, жүжиг
    'detective',    -- детектив, триллер
    'scifi',        -- шинжлэх ухааны зөгнөлт
    'fantasy',      -- фантастик
    'comics',       -- комик, манга
    -- Танин мэдэхүй
    'nonfiction',   -- эсээ, танин мэдэхүй
    'biography',    -- намтар, дурсамж
    'history',      -- түүх
    'science',      -- шинжлэх ухаан
    'nature',       -- байгаль, амьтан
    'technology',   -- технологи, программчлал
    'medicine',     -- эрүүл мэнд, эмнэлэг
    'religion',     -- шашин, философи
    'politics',     -- улс төр
    'law',          -- эрх зүй
    'business',     -- бизнес, эдийн засаг
    -- Хувь хүн ба ахуй
    'selfhelp',     -- хувь хүний хөгжил
    'psychology',   -- сэтгэл судлал
    'parenting',    -- хүүхэд хүмүүжил
    'cooking',      -- хоол, ундаа
    'travel',       -- аялал
    'sport',        -- спорт
    'art',          -- урлаг
    -- Сурах, лавлах
    'children',     -- хүүхдийн
    'textbook',     -- сурах бичиг
    'language',     -- гадаад хэл
    'reference',    -- толь бичиг, лавлах
    'other'));

-- Five is the cap: a book tagged with a dozen headings says nothing about
-- itself, and the card has room to show a few.
alter table public.books
  add column categories public.book_category[] not null default '{}'
  constraint books_categories_len check (coalesce(array_length(categories, 1), 0) <= 5);

update public.books
   set categories = array[category]::public.book_category[]
 where category is not null;

drop index if exists public.books_category_idx;
alter table public.books drop column category;

-- Overlap (`&&`) and containment (`@>`) both read this; PostgREST's `cs`
-- filter compiles to the latter.
create index books_categories_idx on public.books using gin (categories);

-- ── 2. Is this submission the same work as that row? ──────────────────────
-- The comparison is the whole mechanism behind both reuse and forking, so it
-- lives in one place. Normalisation matches what the insert would have stored,
-- otherwise a trailing space would read as a different book.

create or replace function private.category_key(p public.book_category[])
returns text language sql immutable set search_path = ''
as $$
  select coalesce(
    (select string_agg(distinct c::text, ',' order by c::text)
       from unnest(coalesce(p, '{}'::public.book_category[])) c),
    '');
$$;

create or replace function private.book_is_same(
  p_book_id      uuid,
  p_title        text,
  p_author       text,
  p_isbn         text,
  p_publisher    text,
  p_language     text,
  p_description  text,
  p_published_at date,
  p_categories   public.book_category[],
  p_page_count   int,
  p_weight_g     int,
  p_size_note    text)
returns boolean language sql stable set search_path = ''
as $$
  select b.title        is not distinct from btrim(p_title)
     and b.author       is not distinct from nullif(btrim(coalesce(p_author,'')),'')
     and b.isbn         is not distinct from nullif(btrim(coalesce(p_isbn,'')),'')
     and b.publisher    is not distinct from nullif(btrim(coalesce(p_publisher,'')),'')
     and b.language     is not distinct from nullif(btrim(coalesce(p_language,'')),'')
     and b.description  is not distinct from nullif(btrim(coalesce(p_description,'')),'')
     and b.published_at is not distinct from p_published_at
     and b.page_count   is not distinct from p_page_count
     and b.weight_g     is not distinct from p_weight_g
     and b.size_note    is not distinct from nullif(btrim(coalesce(p_size_note,'')),'')
     and private.category_key(b.categories) = private.category_key(p_categories)
    from public.books b
   where b.id = p_book_id;
$$;

-- ── 3. Creating a listing, reusing the catalogue row when it fits ─────────

create or replace function public.create_book_with_copy(
  p_title          text,
  p_author         text default null,
  p_isbn           text default null,
  p_publisher      text default null,
  p_language       text default null,
  p_description    text default null,
  p_published_year int  default null,
  p_condition      public.book_condition default 'good',
  p_condition_note text default null,
  p_categories     public.book_category[] default null,
  p_page_count     int  default null,
  p_weight_g       int  default null,
  p_size_note      text default null,
  -- The row the reader picked from "энэ ном биш биз?". A hint, not an
  -- instruction: it is used only if what they submitted still describes that
  -- book. Editing one field is how you say "no, mine is different".
  p_book_id        uuid default null)
returns table (book_id uuid, copy_id uuid)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_book_id uuid;
  v_copy_id uuid;
  v_recent int;
  v_published_at date := case when p_published_year is null then null
                              else make_date(p_published_year, 1, 1) end;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles
                  where id = v_actor and account_status = 'active') then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  select count(*) into v_recent from public.book_copies
   where owner_id = v_actor and created_at > now() - interval '24 hours';
  if v_recent >= 30 then
    raise exception 'RATE_LIMIT_BOOK_CREATE' using errcode = '54000';
  end if;

  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'TITLE_REQUIRED' using errcode = '23514';
  end if;

  -- A hidden or removed row is not offered as a suggestion and is not joined to
  -- either; the listing gets its own row instead of inheriting a moderation
  -- decision that was about somebody else.
  if p_book_id is not null
     and exists (select 1 from public.books
                  where id = p_book_id and moderation_status = 'active')
     and private.book_is_same(p_book_id, p_title, p_author, p_isbn, p_publisher,
                              p_language, p_description, v_published_at,
                              p_categories, p_page_count, p_weight_g, p_size_note)
  then
    v_book_id := p_book_id;
  else
    insert into public.books (title, author, isbn, publisher, language,
                              description, published_at, created_by,
                              categories, page_count, weight_g, size_note)
    values (btrim(p_title), nullif(btrim(coalesce(p_author,'')),''),
            nullif(btrim(coalesce(p_isbn,'')),''),
            nullif(btrim(coalesce(p_publisher,'')),''),
            nullif(btrim(coalesce(p_language,'')),''),
            nullif(btrim(coalesce(p_description,'')),''),
            v_published_at, v_actor,
            coalesce(p_categories, '{}'::public.book_category[]),
            p_page_count, p_weight_g,
            nullif(btrim(coalesce(p_size_note,'')),''))
    returning id into v_book_id;
  end if;

  insert into public.book_copies (book_id, owner_id, custodian_id,
                                  condition, condition_note)
  values (v_book_id, v_actor, v_actor, p_condition,
          nullif(btrim(coalesce(p_condition_note,'')),''))
  returning id into v_copy_id;

  insert into public.ownership_events (book_copy_id, from_owner_id, to_owner_id,
                                       event_type, actor_id)
  values (v_copy_id, null, v_actor, 'initial_registration', v_actor);

  perform private.write_audit(v_actor, 'book_copy.created', 'book_copy',
                              v_copy_id::text, 'success',
                              jsonb_build_object('book_id', v_book_id,
                                                 'reused', v_book_id = p_book_id));

  return query select v_book_id, v_copy_id;
end $$;

-- ── 4. Editing a listing, forking a shared row rather than rewriting it ───

create or replace function public.update_listing(
  p_copy_id        uuid,
  p_title          text,
  p_author         text default null,
  p_isbn           text default null,
  p_publisher      text default null,
  p_language       text default null,
  p_description    text default null,
  p_published_year int  default null,
  p_condition      public.book_condition default 'good',
  p_condition_note text default null,
  p_categories     public.book_category[] default null,
  p_page_count     int  default null,
  p_weight_g       int  default null,
  p_size_note      text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_book  uuid;
  v_new_book uuid;
  v_shared boolean;
  v_published_at date := case when p_published_year is null then null
                              else make_date(p_published_year, 1, 1) end;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'TITLE_REQUIRED' using errcode = '23514';
  end if;

  select owner_id, book_id into v_owner, v_book
    from public.book_copies where id = p_copy_id;
  if v_owner is null then
    raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_owner <> v_actor then
    raise exception 'NOT_YOUR_LISTING' using errcode = '42501';
  end if;

  select exists (select 1 from public.book_copies
                  where book_id = v_book and id <> p_copy_id)
    into v_shared;

  if v_shared and not private.book_is_same(v_book, p_title, p_author, p_isbn,
                                           p_publisher, p_language, p_description,
                                           v_published_at, p_categories,
                                           p_page_count, p_weight_g, p_size_note)
  then
    -- Somebody else is describing their copy with this row. Take a copy of the
    -- description rather than the argument: the edit lands on a row this
    -- listing alone points at, and nobody else's page changes.
    insert into public.books (title, author, isbn, publisher, language,
                              description, published_at, created_by,
                              categories, page_count, weight_g, size_note)
    values (btrim(p_title), nullif(btrim(coalesce(p_author,'')),''),
            nullif(btrim(coalesce(p_isbn,'')),''),
            nullif(btrim(coalesce(p_publisher,'')),''),
            nullif(btrim(coalesce(p_language,'')),''),
            nullif(btrim(coalesce(p_description,'')),''),
            v_published_at, v_actor,
            coalesce(p_categories, '{}'::public.book_category[]),
            p_page_count, p_weight_g,
            nullif(btrim(coalesce(p_size_note,'')),''))
    returning id into v_new_book;

    -- book_copies_guard refuses a book_id change outside a privileged context;
    -- this function is SECURITY DEFINER and owned by the superuser, so it is
    -- inside one. That is the only reason re-pointing is allowed at all.
    update public.book_copies set book_id = v_new_book where id = p_copy_id;
    v_book := v_new_book;
  else
    update public.books
       set title        = btrim(p_title),
           author       = nullif(btrim(coalesce(p_author,'')),''),
           isbn         = nullif(btrim(coalesce(p_isbn,'')),''),
           publisher    = nullif(btrim(coalesce(p_publisher,'')),''),
           language     = nullif(btrim(coalesce(p_language,'')),''),
           description  = nullif(btrim(coalesce(p_description,'')),''),
           published_at = v_published_at,
           categories   = coalesce(p_categories, '{}'::public.book_category[]),
           page_count   = p_page_count,
           weight_g     = p_weight_g,
           size_note    = nullif(btrim(coalesce(p_size_note,'')),''),
           updated_at   = now()
     where id = v_book;
  end if;

  update public.book_copies
     set condition      = p_condition,
         condition_note = nullif(btrim(coalesce(p_condition_note,'')),'')
   where id = p_copy_id;

  perform private.write_audit(v_actor, 'listing.updated', 'book_copy',
                              p_copy_id::text, 'success',
                              jsonb_build_object('book_id', v_book,
                                                 'forked', v_new_book is not null));
end $$;

drop function if exists public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text,public.book_category,int,int,text);
drop function if exists public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text,public.book_category,int,int,text);

revoke all on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,int,text,uuid) from public, anon;
grant execute on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,int,text,uuid) to authenticated;
revoke all on function public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,int,text) from public, anon;
grant execute on function public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,int,text) to authenticated;

-- ── 5. Suggesting catalogue rows by title ─────────────────────────────────
-- Titles only, on purpose: the reader is answering "is this the same book?",
-- and matching their half-typed title against somebody's description turns that
-- question into a guess. Returns works, not listings — several people may hold
-- the same one, and the answer is the same row for all of them.
--
-- SECURITY DEFINER because it reads across everyone's books; only active,
-- unmoderated rows leave the function, which is exactly what `books` RLS
-- already permits, so nothing is widened.

create or replace function public.suggest_catalogue(p_query text, p_limit int default 6)
returns table (
  id           uuid,
  title        text,
  author       text,
  isbn         text,
  publisher    text,
  language     text,
  description  text,
  published_at date,
  categories   text[],
  page_count   int,
  weight_g     int,
  size_note    text,
  copy_count   bigint,
  cover_key    text)
language sql stable security definer set search_path = ''
as $$
  with matches as (
    select b.*,
           (select count(*) from public.book_copies c
             where c.book_id = b.id and c.moderation_status = 'active') as copies
      from public.books b
     where b.moderation_status = 'active'
       and length(btrim(coalesce(p_query, ''))) >= 2
       and public.solio_norm(b.title) like '%' || public.solio_norm(p_query) || '%'
     -- Room to collapse forks before the caller's limit applies.
     limit 200
  ),
  -- Forks of the same work look identical to a reader, and offering both asks
  -- them to pick between rows they cannot tell apart. Keep the one most people
  -- are already using — joining that one is what makes the catalogue converge.
  ranked as (
    select m.*,
           row_number() over (
             partition by public.solio_norm(m.title),
                          coalesce(public.solio_norm(m.author), '')
             order by m.copies desc, m.created_at asc, m.id) as rn
      from matches m
  )
  select r.id, r.title, r.author, r.isbn, r.publisher, r.language, r.description,
         r.published_at, r.categories::text[], r.page_count, r.weight_g, r.size_note,
         r.copies,
         (select i.storage_key
            from public.book_copies c
            join public.book_images i on i.book_copy_id = c.id
           where c.book_id = r.id and i.status = 'ready'
           order by c.created_at, i.sort_order
           limit 1)
    from ranked r
   where r.rn = 1
   order by
     -- A title that starts with what was typed is the one being looked for.
     (public.solio_norm(r.title) like public.solio_norm(p_query) || '%') desc,
     r.copies desc,
     length(r.title),
     r.created_at desc
   limit greatest(least(coalesce(p_limit, 6), 20), 1);
$$;

revoke all on function public.suggest_catalogue(text,int) from public, anon;
grant execute on function public.suggest_catalogue(text,int) to authenticated, anon;

-- ── 6. A report tells the staff ──────────────────────────────────────────

alter table public.notifications
  drop constraint notifications_type_check,
  add  constraint notifications_type_check
    check (type in (
      'swap_requested','swap_accepted','swap_rejected','swap_cancelled',
      'swap_confirmed','swap_completed','wishlist_match','review_received',
      'comment_received','report_filed','report_resolved','moderation_action'));

create or replace function private.reports_notify_staff() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_staff uuid[];
begin
  select coalesce(array_agg(distinct user_id), '{}'::uuid[]) into v_staff
    from public.user_roles
   where role::text in ('moderator', 'admin');

  -- emit_event drops the actor from the list, so a moderator reporting
  -- something is not told about their own report.
  perform private.emit_event('report_filed', 'report', new.id, v_staff,
                             new.reporter_id,
                             jsonb_build_object('reason', new.reason,
                                                'target_type', new.entity_type,
                                                'target_id', new.entity_id));
  return new;
end $$;

drop trigger if exists reports_notify_staff on public.reports;
create trigger reports_notify_staff
  after insert on public.reports
  for each row execute function private.reports_notify_staff();
