-- Two things a moderator and a reader each need, and neither had.
--
-- ── 1. Staff can remove anything ──────────────────────────────────────────
-- delete_listing refuses a listing that is inside a live swap, which is right
-- for an owner: pulling a book out from under somebody mid-handover is exactly
-- the move that rule exists to stop. It is wrong for a moderator. The reason
-- something has to go — a slur typed into a title, a photograph nobody should
-- be looking at — does not pause while a swap runs its course, and "cancel the
-- swap first, then delete" is a two-step dance around a one-step decision.
--
-- So: a separate function, admin only, that clears the way and then deletes.
-- Every swap the copy is in is cancelled first, with both participants told,
-- and the whole thing is written to the audit log with the actor's id.

create or replace function public.admin_delete_listing(p_copy_id uuid, p_reason text default null)
returns table (storage_key text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_book  uuid;
  v_keys  text[] := '{}';
  v_swaps uuid[] := '{}';
  v_swap  uuid;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  -- Admin, not moderator. The existing split stands: a moderator hides content
  -- and an admin destroys it, and this function destroys.
  if not private.has_role('admin') then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;

  select owner_id, book_id into v_owner, v_book
    from public.book_copies where id = p_copy_id;
  if v_owner is null then
    raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(i.storage_key), '{}') into v_keys
    from public.book_images i where i.book_copy_id = p_copy_id;

  -- Swaps first, so nobody is left holding half an agreement. Cancelled rather
  -- than deleted: the other participant's own book stays theirs, and the record
  -- of what happened is the thing a complaint will be answered from.
  select coalesce(array_agg(distinct s.id), '{}') into v_swaps
    from public.swap_items i
    join public.swaps s on s.id = i.swap_id
   where i.book_copy_id = p_copy_id
     and s.status in ('REQUESTED', 'ACCEPTED', 'CONFIRMED');

  foreach v_swap in array v_swaps loop
    update public.swaps
       set status = 'CANCELLED', closed_at = now()
     where id = v_swap;
    -- Anything the swap had locked goes back on the shelf.
    update public.book_copies bc
       set status = 'available'
     where bc.status = 'reserved'
       and bc.id in (select book_copy_id from public.swap_items where swap_id = v_swap)
       and bc.id <> p_copy_id;
    perform private.emit_event('swap_cancelled', 'swap', v_swap,
                               array[(select requester_id from public.swaps where id = v_swap),
                                     (select responder_id from public.swaps where id = v_swap)],
                               v_actor,
                               jsonb_build_object('reason', 'moderation'));
  end loop;

  perform private.write_audit(v_actor, 'listing.admin_deleted', 'book_copy',
                              p_copy_id::text, 'success',
                              jsonb_build_object('book_id', v_book,
                                                 'owner_id', v_owner,
                                                 'swaps_cancelled', coalesce(array_length(v_swaps, 1), 0),
                                                 'images', coalesce(array_length(v_keys, 1), 0),
                                                 'reason', p_reason));

  -- The ownership ledger is append-only by trigger. This is the one act the
  -- operator escape hatch exists for, and it is taken deliberately, inside a
  -- function that has already checked for staff and written an audit row.
  perform set_config('solio.allow_history_mutation', 'on', true);
  delete from public.ownership_events where book_copy_id = p_copy_id;
  perform set_config('solio.allow_history_mutation', 'off', true);

  -- Photos, comments, claims, swap items and the shelf pointer all cascade.
  delete from public.book_copies where id = p_copy_id;

  -- A catalogue row nobody lists any more is litter.
  delete from public.books b
   where b.id = v_book
     and not exists (select 1 from public.book_copies c where c.book_id = b.id);

  return query select unnest(v_keys);
end $$;

revoke all on function public.admin_delete_listing(uuid, text) from public, anon;
grant execute on function public.admin_delete_listing(uuid, text) to authenticated;

-- ── 2. Where a thing has been ─────────────────────────────────────────────
-- Every transfer is already recorded — that is what ownership_events is for —
-- and none of it was ever shown. A second-hand book's history is the most
-- interesting thing about it, and on a site whose whole premise is that objects
-- outlive their owners it should not be locked in a table only the database
-- reads.
--
-- Public, like the listing it belongs to: every name in it is a public profile
-- and every transfer is already visible as a changed owner. What it adds is the
-- order they happened in.

create or replace function public.copy_trail(p_copy_id uuid)
returns table (
  event_type   text,
  occurred_at  timestamptz,
  from_name    text,
  from_user    text,
  to_name      text,
  to_user      text)
language sql stable security definer set search_path = ''
as $$
  select e.event_type::text, e.occurred_at,
         fp.display_name, fp.username,
         tp.display_name, tp.username
    from public.ownership_events e
    join public.book_copies c on c.id = e.book_copy_id
    join public.profiles tp on tp.id = e.to_owner_id
    left join public.profiles fp on fp.id = e.from_owner_id
   where e.book_copy_id = p_copy_id
     and c.moderation_status = 'active'
   order by e.occurred_at, e.id;
$$;
revoke all on function public.copy_trail(uuid) from public;
grant execute on function public.copy_trail(uuid) to anon, authenticated;

-- The shell already knows whether somebody is staff; destroying content is an
-- admin's alone, so the page that draws that button has to be able to tell the
-- two apart without a second round trip.
drop function if exists public.session_context();

create function public.session_context()
returns table (
  user_id        uuid,
  email          text,
  username       text,
  display_name   text,
  city           text,
  avatar_key     text,
  account_status text,
  account_type   text,
  is_staff       boolean,
  is_admin       boolean,
  unread_count   int,
  credits        int)
language sql stable security definer set search_path = ''
as $$
  select
    p.id,
    u.email::text,
    p.username,
    p.display_name,
    p.city,
    p.avatar_key,
    p.account_status::text,
    p.account_type::text,
    exists (select 1 from public.user_roles r
             where r.user_id = p.id and r.role in ('moderator','admin')),
    exists (select 1 from public.user_roles r
             where r.user_id = p.id and r.role = 'admin'),
    (select count(*)::int from public.notifications n
      where n.user_id = p.id and n.read_at is null),
    private.credit_balance(p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = (select auth.uid())
$$;

revoke all     on function public.session_context() from public;
grant  execute on function public.session_context() to anon, authenticated;
