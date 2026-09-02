-- Match open wishlist requests against a book that just gained a copy, and
-- notify the requesters. Called from create_book_with_copy, so it runs for a
-- brand-new work AND for a new copy of an existing one — the unique index on
-- notifications makes the repeat harmless.

create or replace function private.match_book_requests(
  p_book_id uuid,
  p_actor   uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_book public.books%rowtype;
  v_matched int := 0;
begin
  select * into v_book from public.books where id = p_book_id;
  if not found or v_book.moderation_status <> 'active' then
    return 0;
  end if;

  with hits as (
    select r.id, r.user_id
      from public.book_requests r
     where r.status = 'open'
       and r.matched_book_id is null
       -- Never tell people their own listing matched their own wish.
       and r.user_id is distinct from p_actor
       and (
            -- 1. wishlist entry against this exact work
            r.book_id = p_book_id
            -- 2. same ISBN
         or (r.isbn_norm is not null and v_book.isbn_norm is not null
             and r.isbn_norm = v_book.isbn_norm)
            -- 3. fuzzy title, and author too when the request named one.
            --    Trigram operators must be schema-qualified: search_path is ''.
         or (r.title_norm <> ''
             and r.title_norm operator(extensions.%) v_book.title_norm
             and (r.author is null or v_book.author_norm is null
                  or public.solio_norm(r.author) operator(extensions.%) v_book.author_norm))
       )
     limit 200          -- bounded work per listing
  ),
  updated as (
    update public.book_requests r
       set matched_book_id = p_book_id, matched_at = now()
      from hits h
     where r.id = h.id
    returning r.user_id
  )
  select count(*) into v_matched from updated;

  if v_matched > 0 then
    -- One row per distinct user; the partial unique index absorbs repeats.
    insert into public.notifications (user_id, type, entity_type, entity_id, payload)
    select distinct r.user_id, 'wishlist_match', 'book', p_book_id,
           jsonb_build_object('title', v_book.title)
      from public.book_requests r
     where r.matched_book_id = p_book_id and r.matched_at >= now() - interval '1 second'
    on conflict do nothing;
  end if;

  return v_matched;
end $$;

-- Hook the matcher into listing creation. Same transaction: a rolled-back
-- listing leaves no phantom match or notification.
create or replace function public.create_book_with_copy(
  p_title          text,
  p_author         text default null,
  p_isbn           text default null,
  p_publisher      text default null,
  p_language       text default null,
  p_description    text default null,
  p_published_year int  default null,
  p_condition      public.book_condition default 'good',
  p_condition_note text default null)
returns table (book_id uuid, copy_id uuid)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_isbn_norm text := public.solio_isbn_norm(p_isbn);
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

  if v_isbn_norm is not null then
    select id into v_book_id from public.books where isbn_norm = v_isbn_norm;
  end if;

  if v_book_id is null then
    insert into public.books (title, author, isbn, publisher, language,
                              description, published_at, created_by)
    values (btrim(p_title), nullif(btrim(coalesce(p_author,'')),''),
            nullif(btrim(coalesce(p_isbn,'')),''),
            nullif(btrim(coalesce(p_publisher,'')),''),
            nullif(btrim(coalesce(p_language,'')),''),
            nullif(btrim(coalesce(p_description,'')),''),
            case when p_published_year is null then null
                 else make_date(p_published_year, 1, 1) end,
            v_actor)
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
                              jsonb_build_object('book_id', v_book_id));

  perform private.match_book_requests(v_book_id, v_actor);

  return query select v_book_id, v_copy_id;
end $$;

revoke all     on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text) from public, anon;
grant  execute on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text) to authenticated;
