-- purge_user removed catalogue rows by `created_by = p_user`, which misses the
-- ones whose creator is already gone: books.created_by is ON DELETE SET NULL,
-- so a row orphaned by an earlier deletion is nulled out and then matches
-- nobody. Such a row is invisible in the feed — every listing query joins
-- book_copies — but still sits in search and the moderation queue.
--
-- Keying on the copies actually deleted removes exactly the rows this purge
-- orphaned, whoever created them.

create or replace function private.purge_user(p_user uuid)
returns text language plpgsql security invoker set search_path = ''
as $$
declare
  v_email  text;
  v_swaps  uuid[];
  v_copies uuid[];
  v_books  uuid[];
  v_gone   int;
begin
  if not private.history_override() then
    raise exception 'PURGE_IS_OPERATOR_ONLY' using errcode = '42501',
      hint = 'Run from the Supabase SQL Editor or psql, not the Data API.';
  end if;

  select email into v_email from auth.users where id = p_user;
  if v_email is null then
    raise exception 'NO_SUCH_USER: %', p_user using errcode = 'P0002';
  end if;

  select coalesce(array_agg(id), '{}') into v_swaps
    from public.swaps
   where requester_id = p_user or responder_id = p_user or confirmed_by = p_user;

  select coalesce(array_agg(id), '{}') into v_copies
    from public.book_copies
   where owner_id = p_user or custodian_id = p_user;

  -- The catalogue rows those listings stood on, noted before the listings go.
  select coalesce(array_agg(distinct book_id), '{}') into v_books
    from public.book_copies where id = any(v_copies);

  delete from public.comments
   where user_id = p_user or book_copy_id = any(v_copies);

  delete from public.book_images where uploaded_by = p_user;
  delete from public.reports    where reporter_id = p_user or resolved_by = p_user;
  delete from public.audit_logs where actor_id    = p_user;

  delete from public.ownership_events
   where from_owner_id = p_user
      or to_owner_id   = p_user
      or book_copy_id  = any(v_copies)
      or swap_id       = any(v_swaps);

  delete from public.book_copies where id = any(v_copies);
  delete from public.swaps       where id = any(v_swaps);

  with gone as (
    delete from public.books b
     where (b.id = any(v_books) or b.created_by = p_user)
       and not exists (select 1 from public.book_copies c where c.book_id = b.id)
    returning 1)
  select count(*) into v_gone from gone;

  delete from auth.users where id = p_user;   -- cascades to public.profiles,
                                              -- book_requests and their comments
  return format('purged %s — %s copies, %s catalogue entries',
                v_email, coalesce(array_length(v_copies, 1), 0), v_gone);
end $$;

-- purge_book still deleted from public.book_reviews, which 20260902000260
-- replaced with public.comments. Comments now hang off the copy and cascade
-- with it, so the step is gone rather than renamed.
create or replace function private.purge_book(p_book uuid)
returns text language plpgsql security invoker set search_path = ''
as $$
declare v_title text; v_copies int; v_swaps uuid[];
begin
  if not private.history_override() then
    raise exception 'PURGE_IS_OPERATOR_ONLY' using errcode = '42501';
  end if;

  select title into v_title from public.books where id = p_book;
  if v_title is null then
    raise exception 'NO_SUCH_BOOK: %', p_book using errcode = 'P0002';
  end if;

  select count(*) into v_copies from public.book_copies where book_id = p_book;

  select coalesce(array_agg(distinct i.swap_id), '{}') into v_swaps
    from public.swap_items i
    join public.book_copies c on c.id = i.book_copy_id
   where c.book_id = p_book;

  delete from public.ownership_events
   where swap_id = any(v_swaps)
      or book_copy_id in (select id from public.book_copies where book_id = p_book);
  delete from public.book_copies where book_id = p_book;   -- images, comments cascade
  delete from public.swaps       where id = any(v_swaps);
  delete from public.books       where id = p_book;

  return format('purged %L — %s copies', v_title, v_copies);
end $$;

-- Sweep up the row an earlier purge left behind.
do $$
declare v_id uuid;
begin
  for v_id in
    select b.id from public.books b
     where not exists (select 1 from public.book_copies c where c.book_id = b.id)
  loop
    raise notice '%', private.purge_book(v_id);
  end loop;
end $$;
