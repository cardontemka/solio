-- purge_user still deleted from public.book_reviews, which 20260902000260
-- dropped, so the operator purge would fail with an undefined-table error the
-- next time anybody ran it.
--
-- comments.user_id is ON DELETE RESTRICT (a comment names its author, and that
-- reference should not vanish silently), so the purge has to clear them
-- explicitly. book_requests cascades from profiles, and comments on a request
-- cascade from the request, so those need no separate step — but comments the
-- purged user left on *other* people's requests do.

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

  create temp table _doomed_swaps on commit drop as
    select id from public.swaps
     where requester_id = p_user or responder_id = p_user or confirmed_by = p_user;
  create temp table _doomed_copies on commit drop as
    select id from public.book_copies
     where owner_id = p_user or custodian_id = p_user;

  select count(*) into v_copies from _doomed_copies;

  -- Comments they wrote anywhere, plus every comment on a listing of theirs
  -- (those would otherwise block the copy delete through their own parent).
  delete from public.comments
   where user_id = p_user
      or book_copy_id in (select id from _doomed_copies);

  delete from public.book_images  where uploaded_by = p_user;
  delete from public.reports      where reporter_id = p_user or resolved_by = p_user;
  delete from public.audit_logs   where actor_id    = p_user;

  -- Before the swaps, so no transfer event is left pointing at a swap that no
  -- longer exists.
  delete from public.ownership_events
   where from_owner_id = p_user
      or to_owner_id   = p_user
      or book_copy_id in (select id from _doomed_copies)
      or swap_id       in (select id from _doomed_swaps);

  delete from public.book_copies where id in (select id from _doomed_copies);
  delete from public.swaps       where id in (select id from _doomed_swaps);

  -- Books are shared catalogue rows. One goes only when nothing points at it.
  with gone as (
    delete from public.books b
     where b.created_by = p_user
       and not exists (select 1 from public.book_copies c where c.book_id = b.id)
    returning 1)
  select count(*) into v_books from gone;

  delete from auth.users where id = p_user;   -- cascades to public.profiles,
                                              -- book_requests and their comments
  return format('purged %s — %s copies, %s catalogue entries', v_email, v_copies, v_books);
end $$;

-- Removes the throwaway account used on 2026-09-04 to verify request posts,
-- comments on posts and comments on listings.
do $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = 'req.qa@example.invalid';
  if v_id is not null then
    raise notice '%', private.purge_user(v_id);
  end if;
end $$;
