-- Four things a reader wants to know before asking for a swap: what kind of
-- book it is, how many pages, how big and how heavy.
--
-- Category is constrained rather than free text, because it is meant to be
-- filtered on — a hundred spellings of "уран зохиол" would make the filter
-- useless. The other three are plain measurements, all optional: nobody should
-- have to weigh a book to list it.
--
-- They live on `books` with the rest of the description. Weight and size are
-- strictly properties of an edition rather than of a work, which would matter
-- if one row backed several listings; it does not (ADR-030), and moving them
-- later is a column rename, not a redesign.

create domain public.book_category as text
  constraint book_category_values
  check (value in (
    'fiction',      -- уран зохиол
    'nonfiction',   -- эсээ, танин мэдэхүй
    'history',      -- түүх
    'science',      -- шинжлэх ухаан
    'business',     -- бизнес, эдийн засаг
    'selfhelp',     -- хувь хүний хөгжил
    'psychology',   -- сэтгэл судлал
    'children',     -- хүүхдийн
    'textbook',     -- сурах бичиг
    'language',     -- гадаад хэл
    'art',          -- урлаг
    'other'));

alter table public.books
  add column category    public.book_category,
  add column page_count  int  check (page_count  is null or page_count  between 1 and 20000),
  add column weight_g    int  check (weight_g    is null or weight_g    between 1 and 20000),
  -- Free text: "14×20 см", "A5", "жижиг" — a reader writes what they can see.
  add column size_note   text check (size_note   is null or length(btrim(size_note)) between 1 and 40);

-- The filter reads by category and recency, and only ever wants listed books.
create index books_category_idx on public.books (category, created_at desc)
  where category is not null;

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
  p_category       public.book_category default null,
  p_page_count     int  default null,
  p_weight_g       int  default null,
  p_size_note      text default null)
returns table (book_id uuid, copy_id uuid)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_book_id uuid;
  v_copy_id uuid;
  v_recent int;
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

  insert into public.books (title, author, isbn, publisher, language,
                            description, published_at, created_by,
                            category, page_count, weight_g, size_note)
  values (btrim(p_title), nullif(btrim(coalesce(p_author,'')),''),
          nullif(btrim(coalesce(p_isbn,'')),''),
          nullif(btrim(coalesce(p_publisher,'')),''),
          nullif(btrim(coalesce(p_language,'')),''),
          nullif(btrim(coalesce(p_description,'')),''),
          case when p_published_year is null then null
               else make_date(p_published_year, 1, 1) end,
          v_actor,
          p_category, p_page_count, p_weight_g,
          nullif(btrim(coalesce(p_size_note,'')),''))
  returning id into v_book_id;

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
                              jsonb_build_object('book_id', v_book_id));

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
  p_category       public.book_category default null,
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

  update public.books
     set title        = btrim(p_title),
         author       = nullif(btrim(coalesce(p_author,'')),''),
         isbn         = nullif(btrim(coalesce(p_isbn,'')),''),
         publisher    = nullif(btrim(coalesce(p_publisher,'')),''),
         language     = nullif(btrim(coalesce(p_language,'')),''),
         description  = nullif(btrim(coalesce(p_description,'')),''),
         published_at = case when p_published_year is null then null
                             else make_date(p_published_year, 1, 1) end,
         category     = p_category,
         page_count   = p_page_count,
         weight_g     = p_weight_g,
         size_note    = nullif(btrim(coalesce(p_size_note,'')),''),
         updated_at   = now()
   where id = v_book;

  update public.book_copies
     set condition      = p_condition,
         condition_note = nullif(btrim(coalesce(p_condition_note,'')),'')
   where id = p_copy_id;

  perform private.write_audit(v_actor, 'listing.updated', 'book_copy',
                              p_copy_id::text, 'success',
                              jsonb_build_object('book_id', v_book));
end $$;

-- The old signatures still exist under their own argument lists; drop them so
-- a stale client cannot call a version that silently ignores the new fields.
drop function if exists public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text);
drop function if exists public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text);

revoke all on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text,public.book_category,int,int,text) from public, anon;
grant execute on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text,public.book_category,int,int,text) to authenticated;
revoke all on function public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text,public.book_category,int,int,text) from public, anon;
grant execute on function public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text,public.book_category,int,int,text) to authenticated;
