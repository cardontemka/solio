-- Adding a book is registering YOUR copy, nothing more.
--
-- create_book_with_copy used to look up an existing book by normalised ISBN and
-- attach the new copy to it. That is a book-identity system: it decides that
-- two people's physical books are the same work. It only ever fired when a
-- reader happened to type an ISBN, so identity was applied inconsistently, and
-- it is explicitly out of scope for this MVP.
--
-- From here every registration inserts its own books row. A duplicate title in
-- search is the accepted cost; matching copies to a shared work is a later
-- feature that will need its own review, not a side effect of an ISBN field.
--
-- books_isbn_norm_key had to go with it: it is UNIQUE, so without the lookup
-- the second person to enter the same ISBN would hit a constraint violation
-- instead of registering their book. ISBN keeps a plain index, which is all the
-- search path ever needed.

drop index if exists public.books_isbn_norm_key;
create index if not exists books_isbn_norm_idx
  on public.books (isbn_norm) where isbn_norm is not null;

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

  -- No lookup: the row describes this person's own book.
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

  -- Wishlist matching is unaffected: it already matched on book id, ISBN and
  -- fuzzy title independently of how the books row came to exist.
  perform private.match_book_requests(v_book_id, v_actor);

  return query select v_book_id, v_copy_id;
end $$;

revoke all     on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text) from public, anon;
grant  execute on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text) to authenticated;
