-- Three additions that share one idea: extend what is already here rather than
-- building a parallel copy of it.
--
-- 1. Records. A vinyl record and a book are different objects but the same
--    *transaction*: one person holds one physical copy, offers it, hands it to
--    somebody else, and the history follows the copy. That machinery —
--    book_copies, swaps, ownership_events, images, comments, reports, the
--    catalogue-sharing rule — is indifferent to what the thing is. So the
--    catalogue row grows a `kind` and the fields each kind needs, and nothing
--    downstream changes. A second set of tables would have doubled every one of
--    those mechanisms, and with them every bug.
--
--    The fields that mean different things per kind reuse one column, because
--    they occupy the same place in the description: author/artist,
--    publisher/label. The ones that exist for only one kind get their own —
--    page_count for books, rpm and disc size for records — and stay null for the
--    other, which is what null is for.
--
-- 2. A photo on a request. "I am looking for this" is easier to answer when the
--    cover is on screen. book_images already knows how to hold a photo for a
--    row; it learns a second kind of parent, the same way comments did.
--
-- 3. Replying to a reply. The one-level rule stays — a thread that nests
--    forever is unreadable on a phone — but a reply can now record which comment
--    it is answering, so the page can say so.

-- ── 1. Kind ───────────────────────────────────────────────────────────────

create domain public.item_kind as text
  constraint item_kind_values check (value in ('book', 'vinyl'));

alter table public.books
  add column kind public.item_kind not null default 'book',
  -- 33, 45 or 78 revolutions per minute: the three that were ever made.
  add column rpm smallint check (rpm is null or rpm in (33, 45, 78)),
  -- Inches across, as records are always described.
  add column disc_size text check (disc_size is null or disc_size in ('7', '10', '12')),
  add column track_count int check (track_count is null or track_count between 1 and 200);

-- A record has no pages and a book has no revolutions. Neither is worth an
-- error at the form, but storing one on the other would make the field lie.
alter table public.books
  add constraint books_kind_fields check (
    (kind = 'book'  and rpm is null and disc_size is null and track_count is null)
    or (kind = 'vinyl' and page_count is null));

create index books_kind_feed_idx on public.books (kind, created_at desc);

-- Music genres, alongside the reading ones. Same domain, because a category is
-- a category; which subset a form offers is the form's business.
-- NOT VALID: Postgres refuses to re-verify a domain constraint while a column
-- holds an *array* of that domain, which books.categories now does. Nothing
-- needs verifying — this only widens the set of accepted values, so every row
-- already in the table satisfies it — and the constraint is enforced in full on
-- everything written from here on.
alter domain public.book_category drop constraint book_category_values;
alter domain public.book_category add constraint book_category_values
  check (value in (
    -- Ном
    'fiction', 'classic', 'poetry', 'drama', 'detective', 'scifi', 'fantasy', 'comics',
    'nonfiction', 'biography', 'history', 'science', 'nature', 'technology', 'medicine',
    'religion', 'politics', 'law', 'business',
    'selfhelp', 'psychology', 'parenting', 'cooking', 'travel', 'sport', 'art',
    'children', 'textbook', 'language', 'reference',
    -- Пянз
    'rock', 'pop', 'jazz', 'classical', 'folk', 'hiphop', 'electronic', 'blues',
    'metal', 'country', 'soundtrack', 'mongolian', 'world',
    -- Хоёуланд нь
    'other'))
  not valid;

-- ── 2. Sharing a catalogue row still means "the same thing" ───────────────

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
  p_size_note    text,
  p_kind         public.item_kind default 'book',
  p_rpm          int default null,
  p_disc_size    text default null,
  p_track_count  int default null)
returns boolean language sql stable set search_path = ''
as $$
  select b.kind         is not distinct from p_kind
     and b.title        is not distinct from btrim(p_title)
     and b.author       is not distinct from nullif(btrim(coalesce(p_author,'')),'')
     and b.isbn         is not distinct from nullif(btrim(coalesce(p_isbn,'')),'')
     and b.publisher    is not distinct from nullif(btrim(coalesce(p_publisher,'')),'')
     and b.language     is not distinct from nullif(btrim(coalesce(p_language,'')),'')
     and b.description  is not distinct from nullif(btrim(coalesce(p_description,'')),'')
     and b.published_at is not distinct from p_published_at
     and b.page_count   is not distinct from p_page_count
     and b.weight_g     is not distinct from p_weight_g
     and b.size_note    is not distinct from nullif(btrim(coalesce(p_size_note,'')),'')
     and b.rpm          is not distinct from p_rpm::smallint
     and b.disc_size    is not distinct from nullif(btrim(coalesce(p_disc_size,'')),'')
     and b.track_count  is not distinct from p_track_count
     and private.category_key(b.categories) = private.category_key(p_categories)
    from public.books b
   where b.id = p_book_id;
$$;

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
  p_book_id        uuid default null,
  p_kind           public.item_kind default 'book',
  p_rpm            int  default null,
  p_disc_size      text default null,
  p_track_count    int  default null)
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
  v_disc text := nullif(btrim(coalesce(p_disc_size,'')),'');
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

  -- Kept honest here rather than only by the CHECK, so a form that sends a page
  -- count with a record gets a clean row instead of a constraint error.
  if p_kind = 'vinyl' then
    p_page_count := null;
  else
    p_rpm := null; v_disc := null; p_track_count := null;
  end if;

  if p_book_id is not null
     and exists (select 1 from public.books
                  where id = p_book_id and moderation_status = 'active')
     and private.book_is_same(p_book_id, p_title, p_author, p_isbn, p_publisher,
                              p_language, p_description, v_published_at,
                              p_categories, p_page_count, p_weight_g, p_size_note,
                              p_kind, p_rpm, v_disc, p_track_count)
  then
    v_book_id := p_book_id;
  else
    insert into public.books (title, author, isbn, publisher, language,
                              description, published_at, created_by,
                              categories, page_count, weight_g, size_note,
                              kind, rpm, disc_size, track_count)
    values (btrim(p_title), nullif(btrim(coalesce(p_author,'')),''),
            nullif(btrim(coalesce(p_isbn,'')),''),
            nullif(btrim(coalesce(p_publisher,'')),''),
            nullif(btrim(coalesce(p_language,'')),''),
            nullif(btrim(coalesce(p_description,'')),''),
            v_published_at, v_actor,
            coalesce(p_categories, '{}'::public.book_category[]),
            p_page_count, p_weight_g,
            nullif(btrim(coalesce(p_size_note,'')),''),
            p_kind, p_rpm::smallint, v_disc, p_track_count)
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
                                                 'kind', p_kind,
                                                 'reused', v_book_id = p_book_id));

  return query select v_book_id, v_copy_id;
end $$;

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
  p_size_note      text default null,
  p_kind           public.item_kind default 'book',
  p_rpm            int  default null,
  p_disc_size      text default null,
  p_track_count    int  default null)
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
  v_disc text := nullif(btrim(coalesce(p_disc_size,'')),'');
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'TITLE_REQUIRED' using errcode = '23514';
  end if;

  if p_kind = 'vinyl' then
    p_page_count := null;
  else
    p_rpm := null; v_disc := null; p_track_count := null;
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
                                           p_page_count, p_weight_g, p_size_note,
                                           p_kind, p_rpm, v_disc, p_track_count)
  then
    insert into public.books (title, author, isbn, publisher, language,
                              description, published_at, created_by,
                              categories, page_count, weight_g, size_note,
                              kind, rpm, disc_size, track_count)
    values (btrim(p_title), nullif(btrim(coalesce(p_author,'')),''),
            nullif(btrim(coalesce(p_isbn,'')),''),
            nullif(btrim(coalesce(p_publisher,'')),''),
            nullif(btrim(coalesce(p_language,'')),''),
            nullif(btrim(coalesce(p_description,'')),''),
            v_published_at, v_actor,
            coalesce(p_categories, '{}'::public.book_category[]),
            p_page_count, p_weight_g,
            nullif(btrim(coalesce(p_size_note,'')),''),
            p_kind, p_rpm::smallint, v_disc, p_track_count)
    returning id into v_new_book;

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
           kind         = p_kind,
           rpm          = p_rpm::smallint,
           disc_size    = v_disc,
           track_count  = p_track_count,
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

drop function if exists public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,int,text,uuid);
drop function if exists public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,int,text);
drop function if exists private.book_is_same(uuid,text,text,text,text,text,text,date,public.book_category[],int,int,text);

revoke all on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,int,text,uuid,public.item_kind,int,text,int) from public, anon;
grant execute on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,int,text,uuid,public.item_kind,int,text,int) to authenticated;
revoke all on function public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,int,text,public.item_kind,int,text,int) from public, anon;
grant execute on function public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,int,text,public.item_kind,int,text,int) to authenticated;

-- Suggestions stay within one kind: offering a record while somebody types an
-- album title is the point, offering a novel is noise.
create or replace function public.suggest_catalogue(
  p_query text,
  p_limit int default 6,
  p_kind  public.item_kind default 'book')
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
  kind         text,
  rpm          int,
  disc_size    text,
  track_count  int,
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
       and b.kind = coalesce(p_kind, 'book')
       and length(btrim(coalesce(p_query, ''))) >= 2
       and public.solio_norm(b.title) like '%' || public.solio_norm(p_query) || '%'
     limit 200
  ),
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
         r.kind::text, r.rpm::int, r.disc_size, r.track_count,
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
     (public.solio_norm(r.title) like public.solio_norm(p_query) || '%') desc,
     r.copies desc,
     length(r.title),
     r.created_at desc
   limit greatest(least(coalesce(p_limit, 6), 20), 1);
$$;

drop function if exists public.suggest_catalogue(text,int);
revoke all on function public.suggest_catalogue(text,int,public.item_kind) from public, anon;
grant execute on function public.suggest_catalogue(text,int,public.item_kind) to authenticated, anon;

-- ── 3. A photo on a request ───────────────────────────────────────────────

alter table public.book_images
  alter column book_copy_id drop not null,
  add column request_id uuid references public.book_requests(id) on delete cascade;

alter table public.book_images
  add constraint book_images_target
  check (num_nonnulls(book_copy_id, request_id) = 1);

create index book_images_request_idx on public.book_images (request_id)
  where request_id is not null and status = 'ready';

alter table public.book_images drop constraint book_images_storage_key_check;
alter table public.book_images
  add constraint book_images_storage_key_check
  check (storage_key ~ '^(copies|requests)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$');

alter table public.book_images drop constraint book_images_thumb_key_check;
alter table public.book_images
  add constraint book_images_thumb_key_check
  check (thumb_key is null
         or thumb_key ~ '^(copies|requests)/[0-9a-f-]{36}/[0-9a-f-]{36}-t\.jpg$');

create or replace function private.owns_request(p_request uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.book_requests
                      where id = p_request and user_id = (select auth.uid())) $$;

drop policy if exists book_images_select_public on public.book_images;
create policy book_images_select_public on public.book_images
  for select to anon, authenticated
  using (status = 'ready'
         or (book_copy_id is not null and private.owns_copy(book_copy_id))
         or (request_id is not null and private.owns_request(request_id))
         or private.is_staff());

drop policy if exists book_images_update_owner on public.book_images;
create policy book_images_update_owner on public.book_images
  for update to authenticated
  using      ((book_copy_id is not null and private.owns_copy(book_copy_id))
              or (request_id is not null and private.owns_request(request_id))
              or private.is_staff())
  with check ((book_copy_id is not null and private.owns_copy(book_copy_id))
              or (request_id is not null and private.owns_request(request_id))
              or private.is_staff());

-- One photo per request: it is a "looking for this" notice, not a gallery.
create or replace function public.create_request_image_intent(
  p_request_id uuid,
  p_mime_type  text,
  p_byte_size  int,
  p_provider   text default 'local')
returns table (image_id uuid, storage_key text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_image_id uuid := gen_random_uuid();
  v_ext text;
  v_key text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.book_requests
                  where id = p_request_id and user_id = v_actor) then
    raise exception 'NOT_YOUR_REQUEST' using errcode = '42501';
  end if;

  v_ext := case p_mime_type
             when 'image/jpeg' then 'jpg'
             when 'image/png'  then 'png'
             when 'image/webp' then 'webp'
             else null end;
  if v_ext is null then
    raise exception 'UNSUPPORTED_MIME_TYPE' using errcode = '23514';
  end if;

  if exists (select 1 from public.book_images
              where request_id = p_request_id and status <> 'removed') then
    raise exception 'TOO_MANY_IMAGES' using errcode = '23514';
  end if;

  v_key := 'requests/' || p_request_id::text || '/' || v_image_id::text || '.' || v_ext;

  insert into public.book_images (id, request_id, storage_key, sort_order,
                                  status, mime_type, byte_size, provider, uploaded_by)
  values (v_image_id, p_request_id, v_key, 0, 'pending',
          p_mime_type, p_byte_size, p_provider, v_actor);

  return query select v_image_id, v_key;
end $$;

revoke all on function public.create_request_image_intent(uuid,text,int,text) from public, anon;
grant execute on function public.create_request_image_intent(uuid,text,int,text) to authenticated;

-- publish_image now answers to either parent.
create or replace function public.publish_image(
  p_image_id  uuid,
  p_width     int,
  p_height    int,
  p_byte_size int,
  p_thumb_key text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key   text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select i.storage_key into v_key
    from public.book_images i
    left join public.book_copies c   on c.id = i.book_copy_id
    left join public.book_requests r on r.id = i.request_id
   where i.id = p_image_id
     and i.status = 'pending'
     and coalesce(c.owner_id, r.user_id) = v_actor;
  if v_key is null then
    raise exception 'NOT_YOUR_PENDING_IMAGE' using errcode = '42501';
  end if;

  if p_thumb_key is not null
     and p_thumb_key <> regexp_replace(v_key, '\.(jpg|png|webp)$', '-t.jpg') then
    raise exception 'THUMB_KEY_MISMATCH' using errcode = '42501';
  end if;

  update public.book_images
     set status = 'ready',
         width = p_width,
         height = p_height,
         byte_size = p_byte_size,
         thumb_key = p_thumb_key
   where id = p_image_id;
end $$;

revoke all on function public.publish_image(uuid,int,int,int,text) from public, anon;
grant execute on function public.publish_image(uuid,int,int,int,text) to authenticated;

-- A purged request takes its photo's bytes with it, like a purged listing does.
create or replace function public.purge_content(
  p_entity_type text,
  p_entity_id   uuid,
  p_reason      text default null)
returns table (storage_key text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := private.require_admin('purge.' || p_entity_type, p_entity_type,
                                        p_entity_id::text);
  v_keys text[] := '{}';
  v_label text;
  v_live int;
  v_book uuid;
begin
  if p_entity_type not in ('book_copy', 'book', 'comment', 'request') then
    raise exception 'UNSUPPORTED_ENTITY_TYPE' using errcode = '23514';
  end if;

  case p_entity_type
    when 'book_copy' then
      select b.title, c.book_id into v_label, v_book
        from public.book_copies c join public.books b on b.id = c.book_id
       where c.id = p_entity_id;
      if v_label is null then
        raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
      end if;

      select count(*) into v_live
        from public.swap_items i join public.swaps s on s.id = i.swap_id
       where i.book_copy_id = p_entity_id
         and s.status in ('REQUESTED', 'ACCEPTED', 'CONFIRMED');
      if v_live > 0 then
        raise exception 'LISTING_IN_ACTIVE_SWAP' using errcode = '42501';
      end if;

      select coalesce(array_agg(k), '{}') into v_keys from (
        select i.storage_key as k from public.book_images i where i.book_copy_id = p_entity_id
        union all
        select i.thumb_key from public.book_images i
         where i.book_copy_id = p_entity_id and i.thumb_key is not null) x;

      delete from public.ownership_events where book_copy_id = p_entity_id;
      delete from public.book_copies where id = p_entity_id;

      delete from public.books b
       where b.id = v_book
         and not exists (select 1 from public.book_copies c where c.book_id = b.id);

    when 'book' then
      select b.title into v_label from public.books b where b.id = p_entity_id;
      if v_label is null then
        raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
      end if;

      select count(*) into v_live
        from public.swap_items i
        join public.swaps s on s.id = i.swap_id
        join public.book_copies c on c.id = i.book_copy_id
       where c.book_id = p_entity_id
         and s.status in ('REQUESTED', 'ACCEPTED', 'CONFIRMED');
      if v_live > 0 then
        raise exception 'LISTING_IN_ACTIVE_SWAP' using errcode = '42501';
      end if;

      select coalesce(array_agg(k), '{}') into v_keys from (
        select i.storage_key as k
          from public.book_images i join public.book_copies c on c.id = i.book_copy_id
         where c.book_id = p_entity_id
        union all
        select i.thumb_key
          from public.book_images i join public.book_copies c on c.id = i.book_copy_id
         where c.book_id = p_entity_id and i.thumb_key is not null) x;

      delete from public.ownership_events
       where book_copy_id in (select id from public.book_copies where book_id = p_entity_id);
      delete from public.book_copies where book_id = p_entity_id;
      delete from public.books where id = p_entity_id;

    when 'comment' then
      select left(body, 80) into v_label from public.comments where id = p_entity_id;
      if v_label is null then
        raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
      end if;
      delete from public.comments where id = p_entity_id;

    when 'request' then
      select title into v_label from public.book_requests where id = p_entity_id;
      if v_label is null then
        raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
      end if;

      select coalesce(array_agg(k), '{}') into v_keys from (
        select i.storage_key as k from public.book_images i where i.request_id = p_entity_id
        union all
        select i.thumb_key from public.book_images i
         where i.request_id = p_entity_id and i.thumb_key is not null) x;

      delete from public.book_requests where id = p_entity_id;
  end case;

  update public.reports
     set status = 'resolved',
         resolved_by = v_actor,
         resolved_at = now(),
         resolution_note = coalesce(resolution_note, 'Контентыг устгасан')
   where entity_type = p_entity_type
     and entity_id = p_entity_id
     and status in ('open', 'reviewing');

  perform private.write_audit(v_actor, 'purge.' || p_entity_type, p_entity_type,
                              p_entity_id::text, 'success',
                              jsonb_build_object('label', v_label,
                                                 'reason', p_reason,
                                                 'files', coalesce(array_length(v_keys, 1), 0)));

  return query select unnest(v_keys);
end $$;

revoke all on function public.purge_content(text, uuid, text) from public, anon;
grant execute on function public.purge_content(text, uuid, text) to authenticated;

-- ── 4. Replying to a reply ────────────────────────────────────────────────
-- parent_id still names the thread and stays one level deep. reply_to_id
-- records which comment inside it is being answered, which is what the page
-- needs to print "→ Батаа" and what a reader needs to follow a conversation
-- with more than two people in it.

alter table public.comments
  add column reply_to_id uuid references public.comments(id) on delete set null;

create or replace function private.comments_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare v_parent record;
begin
  if tg_op = 'DELETE' then
    return old;   -- withdrawing your own words carries no history obligation
  end if;

  if tg_op = 'UPDATE' and not private.is_privileged_context() then
    if new.user_id      is distinct from old.user_id
       or new.book_copy_id is distinct from old.book_copy_id
       or new.request_id   is distinct from old.request_id
       or new.parent_id    is distinct from old.parent_id
       or new.reply_to_id  is distinct from old.reply_to_id
       or new.created_at   is distinct from old.created_at then
      raise exception 'COMMENT_IMMUTABLE_FIELD' using errcode = '42501';
    end if;
    if new.moderation_status is distinct from old.moderation_status then
      raise exception 'MODERATION_IS_STAFF_ONLY' using errcode = '42501';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- Inserts run through their own trigger — comments_guard is BEFORE DELETE OR
-- UPDATE only — so the thread rules live here, where a new row passes.
create or replace function private.comments_insert_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare v_parent record; v_target record;
begin
  if new.parent_id is not null then
    select book_copy_id, request_id, parent_id into v_parent
      from public.comments where id = new.parent_id;
    if not found then
      raise exception 'PARENT_COMMENT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_parent.parent_id is not null then
      raise exception 'REPLIES_ARE_ONE_LEVEL' using errcode = '23514',
        hint = 'Reply to the top-level comment instead.';
    end if;
    if new.book_copy_id is distinct from v_parent.book_copy_id
       or new.request_id is distinct from v_parent.request_id then
      raise exception 'REPLY_MUST_MATCH_PARENT_THREAD' using errcode = '23514';
    end if;
  end if;

  -- Whoever is being answered has to be in this thread: the root itself, or one
  -- of its replies. Anything else would print a name from another page.
  if new.reply_to_id is not null then
    if new.parent_id is null then
      raise exception 'REPLY_TARGET_NEEDS_PARENT' using errcode = '23514';
    end if;
    select id, parent_id into v_target from public.comments where id = new.reply_to_id;
    if not found then
      raise exception 'REPLY_TARGET_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_target.id is distinct from new.parent_id
       and v_target.parent_id is distinct from new.parent_id then
      raise exception 'REPLY_TARGET_OUTSIDE_THREAD' using errcode = '23514';
    end if;
  end if;

  return new;
end $$;
