-- purge_user built its working sets as ON COMMIT DROP temp tables, so a second
-- call inside one transaction failed with "relation _doomed_swaps already
-- exists". Purging two accounts at once is the obvious thing to want, and a
-- migration is a single transaction, so the function could not do the job it
-- was written for. Arrays hold the same sets with no session-lifetime object.

create or replace function private.purge_user(p_user uuid)
returns text language plpgsql security invoker set search_path = ''
as $$
declare
  v_email  text;
  v_swaps  uuid[];
  v_copies uuid[];
  v_books  int;
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

  -- Comments they wrote anywhere, plus every comment on a listing of theirs.
  delete from public.comments
   where user_id = p_user or book_copy_id = any(v_copies);

  delete from public.book_images where uploaded_by = p_user;
  delete from public.reports    where reporter_id = p_user or resolved_by = p_user;
  delete from public.audit_logs where actor_id    = p_user;

  -- Before the swaps, so no transfer event is left pointing at a swap that no
  -- longer exists.
  delete from public.ownership_events
   where from_owner_id = p_user
      or to_owner_id   = p_user
      or book_copy_id  = any(v_copies)
      or swap_id       = any(v_swaps);

  delete from public.book_copies where id = any(v_copies);
  delete from public.swaps       where id = any(v_swaps);

  -- Books are shared catalogue rows. One goes only when nothing points at it.
  with gone as (
    delete from public.books b
     where b.created_by = p_user
       and not exists (select 1 from public.book_copies c where c.book_id = b.id)
    returning 1)
  select count(*) into v_books from gone;

  delete from auth.users where id = p_user;   -- cascades to public.profiles,
                                              -- book_requests and their comments
  return format('purged %s — %s copies, %s catalogue entries',
                v_email, coalesce(array_length(v_copies, 1), 0), v_books);
end $$;

-- Removes the throwaway accounts used on 2026-09-05 to verify this batch:
-- avatar upload, the listing edit/delete menu, and a full swap run through to
-- completion so that swapped listings and their photos could be checked.
do $$
declare v_id uuid;
begin
  for v_id in
    select id from auth.users
     where email like 'swapqa.%@example.invalid'
        or email = 'ui.qa@example.invalid'
  loop
    raise notice '%', private.purge_user(v_id);
  end loop;
end $$;
