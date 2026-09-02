-- purge_user dropped catalogue entries the user created but nobody holds a
-- copy of, which fails as soon as somebody else has reviewed one: a book row
-- is shared, so "its creator left" is not a reason to delete it out from under
-- other people's data. Only genuinely unreferenced entries go.

create or replace function private.purge_user(p_user uuid)
returns text language plpgsql security invoker set search_path = ''
as $$
declare v_copies int; v_books int; v_email text;
begin
  if not private.history_override() then
    raise exception 'PURGE_IS_OPERATOR_ONLY' using errcode = '42501',
      hint = 'Run from the Supabase SQL Editor or psql, not the Data API.';
  end if;

  select email into v_email from auth.users where id = p_user;
  if v_email is null then
    raise exception 'NO_SUCH_USER: %', p_user using errcode = 'P0002';
  end if;

  -- Rows that RESTRICT the profile delete, in dependency order. Everything
  -- else either cascades from profiles or nulls out.
  delete from public.book_images  where uploaded_by = p_user;
  delete from public.book_reviews where user_id     = p_user;
  delete from public.reports      where reporter_id = p_user or resolved_by = p_user;
  delete from public.swaps        where requester_id = p_user
                                     or responder_id = p_user
                                     or confirmed_by = p_user;

  select count(*) into v_copies from public.book_copies
   where owner_id = p_user or custodian_id = p_user;

  delete from public.ownership_events
   where from_owner_id = p_user
      or to_owner_id   = p_user
      or book_copy_id in (select id from public.book_copies
                           where owner_id = p_user or custodian_id = p_user);
  delete from public.book_copies where owner_id = p_user or custodian_id = p_user;

  -- Books are shared catalogue entries. One is removed only when nothing at
  -- all still points at it; otherwise it keeps its row with created_by null.
  with gone as (
    delete from public.books b
     where b.created_by = p_user
       and not exists (select 1 from public.book_copies   c where c.book_id = b.id)
       and not exists (select 1 from public.book_reviews  r where r.book_id = b.id)
       and not exists (select 1 from public.book_requests q
                        where q.book_id = b.id or q.matched_book_id = b.id)
    returning 1)
  select count(*) into v_books from gone;

  delete from auth.users where id = p_user;   -- cascades to public.profiles

  return format('purged %s — %s copies, %s catalogue entries', v_email, v_copies, v_books);
end $$;
