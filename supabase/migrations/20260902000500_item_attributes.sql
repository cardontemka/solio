-- The fields that belong to one kind of thing move out of the table and into a
-- jsonb column, so that adding a third kind adds no columns at all.
--
-- The problem, measured before deciding:
--
--   · `books` had 24 columns, six of them belonging to one kind only —
--     isbn/isbn_norm/page_count for books, rpm/disc_size/track_count for
--     records. Two kinds, three each.
--   · create_book_with_copy and update_listing were at 18 parameters each, and
--     every new kind adds three to five to both.
--   · Not one of the kind-specific fields is ever filtered, sorted or joined
--     on. They are printed on the detail page and nowhere else.
--
-- That last point is what decides it. A column earns its place by being
-- something the database reasons about: an index, a join, a constraint another
-- row depends on. A value that is only ever read back and displayed is carrying
-- the cost of a column — a migration, two RPC parameters, a type, a form field,
-- a mapper line — and returning none of it. Sparse NULL columns are close to
-- free on disk (one bit each in the null bitmap); the expense was never storage,
-- it was the churn.
--
-- What stays a column, and why:
--
--   isbn, isbn_norm   feed the search vector and the request matcher. The
--                     database genuinely uses them.
--   weight_g,         true of any physical object, not of one kind. A record
--   size_note         has a weight and a sleeve size like a book has a weight
--                     and a jacket size.
--   categories, kind  filtered on, every page.
--
-- What moves: page_count, rpm, disc_size, track_count — and every field the
-- next kind brings with it.
--
-- Where the rules live. `authenticated` holds SELECT and nothing else on
-- `books`; the only write path is these two SECURITY DEFINER functions. So the
-- shape of the jsonb is enforced where it is written rather than by a CHECK
-- constraint calling an immutable validator — same guarantee, one place, and it
-- can return a useful error instead of a constraint violation.

alter table public.books add column attributes jsonb not null default '{}'::jsonb;

update public.books
   set attributes = (
     select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
       from (values ('page_count',  to_jsonb(page_count)),
                    ('rpm',         to_jsonb(rpm)),
                    ('disc_size',   to_jsonb(disc_size)),
                    ('track_count', to_jsonb(track_count))) as t(k, v)
      where v is not null and v <> 'null'::jsonb);

alter table public.books drop constraint books_kind_fields;
alter table public.books
  drop column page_count,
  drop column rpm,
  drop column disc_size,
  drop column track_count;

-- Not needed by anything today — nothing filters on these — but a GIN index on
-- the column is what makes `attributes @> '{"rpm": 33}'` cheap the day
-- somebody wants to browse by it, and it costs one index on a small table.
create index books_attributes_idx on public.books using gin (attributes);

-- ── What each kind may carry ──────────────────────────────────────────────
-- One function, one place. A new kind is a branch here and a branch in the
-- label map on the client; no column, no parameter, no type.
--
--   type  'int'  → whole number, clamped to min/max
--         'text' → trimmed string, capped at max
--         'enum' → must be one of `values`
create or replace function private.item_attribute_spec(p_kind public.item_kind)
returns jsonb language sql immutable set search_path = ''
as $$
  select case p_kind
    when 'book' then jsonb_build_object(
      'page_count', jsonb_build_object('type', 'int', 'min', 1, 'max', 20000))
    when 'vinyl' then jsonb_build_object(
      'rpm',         jsonb_build_object('type', 'enum', 'values', jsonb_build_array(33, 45, 78)),
      'disc_size',   jsonb_build_object('type', 'enum', 'values', jsonb_build_array('7', '10', '12')),
      'track_count', jsonb_build_object('type', 'int', 'min', 1, 'max', 200))
    else '{}'::jsonb
  end;
$$;

/*
 * Keeps what the kind allows and throws the rest away.
 *
 * Silently, on purpose: an unknown key means a stale form or a hand-made
 * request, and neither is worth failing a listing over. A *known* key with an
 * impossible value is different — that is a form that thinks it is sending
 * something real — so those raise.
 */
create or replace function private.clean_attributes(
  p_kind public.item_kind,
  p_input jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  v_spec jsonb := private.item_attribute_spec(p_kind);
  v_out  jsonb := '{}'::jsonb;
  v_key  text;
  v_rule jsonb;
  v_raw  jsonb;
  v_num  numeric;
  v_txt  text;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    return '{}'::jsonb;
  end if;

  for v_key, v_rule in select * from jsonb_each(v_spec) loop
    v_raw := p_input -> v_key;
    continue when v_raw is null or jsonb_typeof(v_raw) = 'null';

    case v_rule ->> 'type'
      when 'int' then
        begin
          v_num := (v_raw #>> '{}')::numeric;
        exception when others then
          raise exception 'ATTRIBUTE_NOT_A_NUMBER_%', v_key using errcode = '23514';
        end;
        if v_num <> trunc(v_num)
           or v_num < (v_rule ->> 'min')::numeric
           or v_num > (v_rule ->> 'max')::numeric then
          raise exception 'ATTRIBUTE_OUT_OF_RANGE_%', v_key using errcode = '23514';
        end if;
        v_out := v_out || jsonb_build_object(v_key, trunc(v_num)::bigint);

      when 'enum' then
        -- Compared as text so 33 and "33" are the same answer; a <select> sends
        -- a string whatever the option looked like.
        v_txt := btrim(v_raw #>> '{}');
        continue when v_txt = '';
        if not exists (select 1 from jsonb_array_elements(v_rule -> 'values') e
                        where (e #>> '{}') = v_txt) then
          raise exception 'ATTRIBUTE_NOT_ALLOWED_%', v_key using errcode = '23514';
        end if;
        v_out := v_out || jsonb_build_object(v_key,
          case when jsonb_typeof(v_rule -> 'values' -> 0) = 'number'
               then to_jsonb(v_txt::numeric) else to_jsonb(v_txt) end);

      else
        v_txt := btrim(v_raw #>> '{}');
        continue when v_txt = '';
        v_out := v_out || jsonb_build_object(v_key,
                                             left(v_txt, coalesce((v_rule ->> 'max')::int, 200)));
    end case;
  end loop;

  return v_out;
end $$;

-- ── The three functions that read or write those fields ───────────────────

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
  p_weight_g     int,
  p_size_note    text,
  p_kind         public.item_kind,
  p_attributes   jsonb)
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
     and b.weight_g     is not distinct from p_weight_g
     and b.size_note    is not distinct from nullif(btrim(coalesce(p_size_note,'')),'')
     -- jsonb equality ignores key order, which is what "the same description"
     -- means here.
     and b.attributes   = private.clean_attributes(p_kind, p_attributes)
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
  p_weight_g       int  default null,
  p_size_note      text default null,
  p_book_id        uuid default null,
  p_kind           public.item_kind default 'book',
  p_attributes     jsonb default '{}'::jsonb)
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
  v_attrs jsonb := private.clean_attributes(p_kind, p_attributes);
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

  if p_book_id is not null
     and exists (select 1 from public.books
                  where id = p_book_id and moderation_status = 'active')
     and private.book_is_same(p_book_id, p_title, p_author, p_isbn, p_publisher,
                              p_language, p_description, v_published_at,
                              p_categories, p_weight_g, p_size_note,
                              p_kind, p_attributes)
  then
    v_book_id := p_book_id;
  else
    insert into public.books (title, author, isbn, publisher, language,
                              description, published_at, created_by,
                              categories, weight_g, size_note, kind, attributes)
    values (btrim(p_title), nullif(btrim(coalesce(p_author,'')),''),
            nullif(btrim(coalesce(p_isbn,'')),''),
            nullif(btrim(coalesce(p_publisher,'')),''),
            nullif(btrim(coalesce(p_language,'')),''),
            nullif(btrim(coalesce(p_description,'')),''),
            v_published_at, v_actor,
            coalesce(p_categories, '{}'::public.book_category[]),
            p_weight_g, nullif(btrim(coalesce(p_size_note,'')),''),
            p_kind, v_attrs)
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
  p_weight_g       int  default null,
  p_size_note      text default null,
  p_kind           public.item_kind default 'book',
  p_attributes     jsonb default '{}'::jsonb)
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
  v_attrs jsonb := private.clean_attributes(p_kind, p_attributes);
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
                                           p_weight_g, p_size_note, p_kind, p_attributes)
  then
    insert into public.books (title, author, isbn, publisher, language,
                              description, published_at, created_by,
                              categories, weight_g, size_note, kind, attributes)
    values (btrim(p_title), nullif(btrim(coalesce(p_author,'')),''),
            nullif(btrim(coalesce(p_isbn,'')),''),
            nullif(btrim(coalesce(p_publisher,'')),''),
            nullif(btrim(coalesce(p_language,'')),''),
            nullif(btrim(coalesce(p_description,'')),''),
            v_published_at, v_actor,
            coalesce(p_categories, '{}'::public.book_category[]),
            p_weight_g, nullif(btrim(coalesce(p_size_note,'')),''),
            p_kind, v_attrs)
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
           weight_g     = p_weight_g,
           size_note    = nullif(btrim(coalesce(p_size_note,'')),''),
           kind         = p_kind,
           attributes   = v_attrs,
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

drop function if exists public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,int,text,uuid,public.item_kind,int,text,int);
drop function if exists public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,int,text,public.item_kind,int,text,int);
drop function if exists private.book_is_same(uuid,text,text,text,text,text,text,date,public.book_category[],int,int,text,public.item_kind,int,text,int);

revoke all on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,text,uuid,public.item_kind,jsonb) from public, anon;
grant execute on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,text,uuid,public.item_kind,jsonb) to authenticated;
revoke all on function public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,text,public.item_kind,jsonb) from public, anon;
grant execute on function public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text,public.book_category[],int,text,public.item_kind,jsonb) to authenticated;

-- The OUT columns change shape, which CREATE OR REPLACE cannot do.
drop function if exists public.suggest_catalogue(text,int,public.item_kind);

create function public.suggest_catalogue(
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
  weight_g     int,
  size_note    text,
  kind         text,
  attributes   jsonb,
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
         r.published_at, r.categories::text[], r.weight_g, r.size_note,
         r.kind::text, r.attributes,
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

revoke all on function public.suggest_catalogue(text,int,public.item_kind) from public, anon;
grant execute on function public.suggest_catalogue(text,int,public.item_kind) to authenticated, anon;
