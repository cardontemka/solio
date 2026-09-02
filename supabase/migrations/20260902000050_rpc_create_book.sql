-- Creating a listing writes three rows that must agree: the work, the physical
-- copy, and the opening entry of that copy's ownership ledger. One function,
-- one transaction, so a copy can never exist without a ledger origin.
--
-- SECURITY DEFINER because the client has no INSERT grant on books/book_copies
-- at all — this is the only creation path. It therefore owns its own
-- authorisation, and search_path is pinned.

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

  -- Business-level throttle. Not the only abuse protection: Cloudflare rate
  -- rules and bot protection sit in front of this (see docs/security.md §8).
  select count(*) into v_recent from public.book_copies
   where owner_id = v_actor and created_at > now() - interval '24 hours';
  if v_recent >= 30 then
    raise exception 'RATE_LIMIT_BOOK_CREATE' using errcode = '54000';
  end if;

  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'TITLE_REQUIRED' using errcode = '23514';
  end if;

  -- One work per ISBN: reuse the existing row so copies aggregate under it.
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

  -- Opening entry: a copy can never exist without the start of its chain.
  insert into public.ownership_events (book_copy_id, from_owner_id, to_owner_id,
                                       event_type, actor_id)
  values (v_copy_id, null, v_actor, 'initial_registration', v_actor);

  perform private.write_audit(v_actor, 'book_copy.created', 'book_copy',
                              v_copy_id::text, 'success',
                              jsonb_build_object('book_id', v_book_id));

  return query select v_book_id, v_copy_id;
end $$;

revoke all     on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text) from public, anon;
grant  execute on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text) to authenticated;
