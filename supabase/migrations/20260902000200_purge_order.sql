-- Two ways a purge could still trip the append-only rule, both because a
-- foreign key's ON DELETE SET NULL is an UPDATE — and UPDATE on
-- ownership_events / audit_logs is refused for every role, operator included.
--
--   1. audit_logs.actor_id is SET NULL, so removing a profile tried to rewrite
--      every audit row that person had ever caused.
--   2. 20260902000170 made ownership_events.swap_id SET NULL, which turned
--      "delete a swap" into "rewrite the transfer event that recorded it".
--
-- Neither showed up locally: the seed has no audit rows, and the account the
-- test purged had no completed swap. The cloud project had both.
--
-- The fix is ordering, not exemptions. A purge removes the dependent history
-- itself, in dependency order, so nothing is ever left to null out. swap_id
-- goes back to RESTRICT, which also restores oe_swap_transfer_has_swap to its
-- original, stronger form.

alter table public.ownership_events
  drop constraint ownership_events_swap_id_fkey,
  add  constraint ownership_events_swap_id_fkey
       foreign key (swap_id) references public.swaps(id) on delete restrict;

alter table public.ownership_events drop constraint oe_swap_transfer_has_swap;
alter table public.ownership_events
  add constraint oe_swap_transfer_has_swap
  check ((event_type = 'swap_transfer') = (swap_id is not null));

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

  delete from public.book_images  where uploaded_by = p_user;
  delete from public.book_reviews where user_id     = p_user;
  delete from public.reports      where reporter_id = p_user or resolved_by = p_user;
  delete from public.audit_logs   where actor_id    = p_user;

  -- Before the swaps, so no transfer event is left pointing at a swap that
  -- no longer exists.
  delete from public.ownership_events
   where from_owner_id = p_user
      or to_owner_id   = p_user
      or book_copy_id in (select id from _doomed_copies)
      or swap_id       in (select id from _doomed_swaps);

  delete from public.book_copies where id in (select id from _doomed_copies);
  delete from public.swaps       where id in (select id from _doomed_swaps);

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

create or replace function private.purge_book(p_book uuid)
returns text language plpgsql security invoker set search_path = ''
as $$
declare v_title text; v_copies int;
begin
  if not private.history_override() then
    raise exception 'PURGE_IS_OPERATOR_ONLY' using errcode = '42501';
  end if;

  select title into v_title from public.books where id = p_book;
  if v_title is null then
    raise exception 'NO_SUCH_BOOK: %', p_book using errcode = 'P0002';
  end if;

  create temp table _doomed_swaps on commit drop as
    select distinct i.swap_id as id
      from public.swap_items i
      join public.book_copies c on c.id = i.book_copy_id
     where c.book_id = p_book;

  select count(*) into v_copies from public.book_copies where book_id = p_book;

  delete from public.book_reviews where book_id = p_book;
  delete from public.ownership_events
   where swap_id in (select id from _doomed_swaps)
      or book_copy_id in (select id from public.book_copies where book_id = p_book);
  delete from public.book_copies where book_id = p_book;   -- images cascade
  delete from public.swaps       where id in (select id from _doomed_swaps);
  delete from public.books       where id = p_book;

  return format('purged %L — %s copies', v_title, v_copies);
end $$;
