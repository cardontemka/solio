-- A confirmed swap could become impossible to finish and impossible to leave.
--
-- The three doors were all locked at once:
--
--   · complete_swap refused unless every copy still read status = 'reserved'
--     and moderation_status <> 'removed';
--   · respond_to_swap allowed no CONFIRMED → CANCELLED edge at all, on the
--     principle that somebody must not take a book and then back out;
--   · delete_listing refused while any swap referencing the copy was live.
--
-- Each is defensible alone. Together, one moderated copy — or any drift in a
-- copy's status — left both people staring at "Солилцоон дахь ном өөрчлөгдсөн
-- байна" with nothing on the page to click. The swap could not be completed,
-- could not be cancelled, and its books could not be removed. Nothing in the
-- state machine could reach a terminal state again.
--
-- Three changes, in the order they matter:
--
-- 1. complete_swap now asks the question it actually means. "Is this copy still
--    reserved" was a proxy for "has somebody else taken it", and a poor one:
--    reserved is a bookkeeping flag, while the facts that make a transfer wrong
--    are that the copy already changed hands, was handed over in another swap,
--    or is held by a different live swap. Those are checked directly, and a
--    copy whose flag drifted no longer blocks a swap both people agreed on.
--
-- 2. A CONFIRMED swap can be cancelled in exactly two cases: by the person who
--    confirmed it — withdrawing your own assertion is not backing out of
--    somebody else's — and by either party once the swap is genuinely
--    unfulfillable. The rule the original comment protected still holds: you
--    cannot cancel because the other side confirmed and you changed your mind.
--
-- 3. An admin can force a stuck swap closed. After 1 and 2 that should be
--    unreachable, which is exactly when an escape hatch is worth having.

-- CONFIRMED → ACCEPTED is not used by these functions (they run as the owner
-- and skip edge validation) but the table is the written statement of which
-- moves are legal, and cancelling out of CONFIRMED is now one of them.
create or replace function private.is_valid_swap_edge(p_from text, p_to text)
returns boolean language sql immutable set search_path = ''
as $$
  select (p_from, p_to) in (
    ('REQUESTED','ACCEPTED'), ('REQUESTED','REJECTED'), ('REQUESTED','CANCELLED'),
    ('ACCEPTED','CONFIRMED'), ('ACCEPTED','CANCELLED'),
    ('CONFIRMED','COMPLETED'), ('CONFIRMED','CANCELLED'));
$$;

/*
 * Can this swap still be carried out?
 *
 * False when a copy in it has already changed hands, was handed over in another
 * swap, is held by a different live swap, or has been removed by a moderator.
 * Used both to decide whether completion is allowed and to decide whether
 * either party may walk away from a confirmed swap.
 */
create or replace function private.swap_is_fulfillable(p_swap_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1
      from public.swap_items si
      join public.swaps s on s.id = si.swap_id
      join public.book_copies bc on bc.id = si.book_copy_id
     where si.swap_id = p_swap_id
       and (
         bc.owner_id <> case si.side when 'offered' then s.requester_id
                                     else s.responder_id end
         or bc.status = 'swapped'
         or bc.moderation_status = 'removed'
         or exists (select 1
                      from public.swap_items si2
                      join public.swaps s2 on s2.id = si2.swap_id
                     where si2.book_copy_id = bc.id
                       and si2.swap_id <> p_swap_id
                       and s2.status in ('ACCEPTED','CONFIRMED'))
       )
  )
  -- A swap with no items left cannot be carried out either.
  and exists (select 1 from public.swap_items where swap_id = p_swap_id);
$$;

grant execute on function private.swap_is_fulfillable(uuid) to authenticated;

create or replace function public.respond_to_swap(
  p_swap_id uuid,
  p_action  text)          -- 'accept' | 'reject' | 'cancel'
returns public.swaps
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_swap  public.swaps%rowtype;
  v_other uuid;
  v_new_status public.swap_status;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_action not in ('accept','reject','cancel') then
    raise exception 'UNKNOWN_ACTION' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('solio.swap:' || p_swap_id::text, 0));

  select * into v_swap from public.swaps where id = p_swap_id for update;
  if not found then
    raise exception 'SWAP_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Authorise AFTER the lock: checking before leaves a TOCTOU window.
  if v_actor not in (v_swap.requester_id, v_swap.responder_id) then
    raise exception 'NOT_A_PARTICIPANT' using errcode = '42501';
  end if;
  v_other := case when v_actor = v_swap.requester_id
                  then v_swap.responder_id else v_swap.requester_id end;

  if p_action in ('accept','reject') then
    if v_swap.status <> 'REQUESTED' then
      raise exception 'INVALID_TRANSITION_%_TO_%', v_swap.status, upper(p_action)
        using errcode = '23514';
    end if;
    if v_actor <> v_swap.responder_id then
      raise exception 'ONLY_RESPONDER_MAY_%', upper(p_action) using errcode = '42501';
    end if;
  else  -- cancel
    if v_swap.status = 'REQUESTED' and v_actor <> v_swap.requester_id then
      raise exception 'ONLY_REQUESTER_MAY_CANCEL' using errcode = '42501';
    end if;
    if v_swap.status = 'CONFIRMED' then
      -- Withdrawing your own confirmation is allowed; walking away from
      -- somebody else's is not, unless the swap can no longer be carried out
      -- at all — at which point cancelling is tidying up, not backing out.
      if v_swap.confirmed_by is distinct from v_actor
         and private.swap_is_fulfillable(p_swap_id) then
        raise exception 'COUNTERPARTY_ALREADY_CONFIRMED' using errcode = '42501';
      end if;
    elsif v_swap.status not in ('REQUESTED','ACCEPTED') then
      raise exception 'INVALID_TRANSITION_%_TO_CANCELLED', v_swap.status
        using errcode = '23514';
    end if;
  end if;

  -- Lock the copies before moving their status.
  perform 1 from public.book_copies
    where id in (select book_copy_id from public.swap_items where swap_id = p_swap_id)
    order by id for update;

  if p_action = 'accept' then
    if exists (
      select 1 from public.swap_items si
        join public.book_copies bc on bc.id = si.book_copy_id
       where si.swap_id = p_swap_id
         and (bc.status <> 'available' or bc.moderation_status <> 'active')
    ) then
      raise exception 'COPY_NO_LONGER_AVAILABLE' using errcode = '23514';
    end if;

    update public.book_copies set status = 'reserved'
     where id in (select book_copy_id from public.swap_items where swap_id = p_swap_id);
    v_new_status := 'ACCEPTED';

  elsif p_action = 'reject' then
    v_new_status := 'REJECTED';

  else
    -- Release whatever this swap was holding, from either state it can be
    -- cancelled in. A copy that has already moved on is left alone.
    if v_swap.status in ('ACCEPTED','CONFIRMED') then
      update public.book_copies set status = 'available'
       where id in (select book_copy_id from public.swap_items where swap_id = p_swap_id)
         and status = 'reserved';
    end if;
    v_new_status := 'CANCELLED';
  end if;

  update public.swaps
     set status = v_new_status,
         confirmed_by = case when v_new_status = 'CANCELLED' then null else confirmed_by end,
         closed_at = case when v_new_status in ('REJECTED','CANCELLED') then now() end
   where id = p_swap_id and status = v_swap.status
  returning * into v_swap;
  if not found then
    raise exception 'SWAP_STATE_CHANGED_CONCURRENTLY' using errcode = '40001';
  end if;

  perform private.write_audit(v_actor, 'swap.' || p_action, 'swap', p_swap_id::text,
                              'success', jsonb_build_object('to', v_new_status));
  perform private.emit_event('swap_' || lower(v_new_status::text), 'swap', p_swap_id,
                             array[v_other], v_actor);
  return v_swap;
end $$;

revoke all on function public.respond_to_swap(uuid,text) from public, anon;
grant execute on function public.respond_to_swap(uuid,text) to authenticated;

-- ── complete_swap: ask what actually makes a transfer wrong ───────────────

create or replace function public.complete_swap(p_swap_id uuid)
returns public.swaps
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_other uuid;
  v_swap  public.swaps%rowtype;
  v_items int;
  v_locked int;
  v_moved int;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles
                  where id = v_actor and account_status = 'active') then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('solio.swap:' || p_swap_id::text, 0));

  select * into v_swap from public.swaps where id = p_swap_id for update;
  if not found then
    raise exception 'SWAP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_actor not in (v_swap.requester_id, v_swap.responder_id) then
    raise exception 'NOT_A_PARTICIPANT' using errcode = '42501';
  end if;
  v_other := case when v_actor = v_swap.requester_id
                  then v_swap.responder_id else v_swap.requester_id end;

  ---------------------------------------------------------------- PHASE 1
  if v_swap.status = 'ACCEPTED' then
    update public.swaps set status = 'CONFIRMED', confirmed_by = v_actor
     where id = p_swap_id and status = 'ACCEPTED'
    returning * into v_swap;
    if not found then
      raise exception 'SWAP_STATE_CHANGED_CONCURRENTLY' using errcode = '40001';
    end if;
    perform private.write_audit(v_actor, 'swap.confirmed', 'swap', p_swap_id::text);
    perform private.emit_event('swap_confirmed', 'swap', p_swap_id,
                               array[v_other], v_actor);
    return v_swap;
  end if;

  ---------------------------------------------------------------- PHASE 2
  if v_swap.status <> 'CONFIRMED' then
    raise exception 'INVALID_TRANSITION_%_TO_COMPLETED', v_swap.status
      using errcode = '23514';
  end if;
  -- The structural answer to "can one person complete a swap alone?" — no.
  if v_swap.confirmed_by = v_actor then
    raise exception 'AWAITING_COUNTERPARTY_CONFIRMATION' using errcode = '23514';
  end if;

  select count(*) into v_locked from (
    select bc.id from public.book_copies bc
     where bc.id in (select si.book_copy_id from public.swap_items si
                      where si.swap_id = p_swap_id)
     order by bc.id for update) l;

  select count(*) into v_items from public.swap_items where swap_id = p_swap_id;
  if v_items = 0 then
    raise exception 'SWAP_HAS_NO_ITEMS' using errcode = '23514';
  end if;
  if v_locked <> v_items then
    raise exception 'SWAP_ITEM_COPY_MISSING' using errcode = '23503';
  end if;

  -- Re-checked AFTER the lock, and against the facts that matter: has a copy
  -- already changed hands, gone in another swap, been claimed by a different
  -- live swap, or been removed. `status = 'reserved'` used to stand in for all
  -- of that and turned any drift in a bookkeeping flag into a dead swap.
  if not private.swap_is_fulfillable(p_swap_id) then
    raise exception 'OWNERSHIP_OR_STATUS_MISMATCH' using errcode = '23514',
      hint = 'A copy in this swap changed owner, was removed, or is in another swap.';
  end if;

  -- Transfer + ledger entry in ONE statement, so they cannot diverge.
  with items as (
    select si.book_copy_id,
           bc.owner_id as from_owner,
           case si.side when 'offered' then v_swap.responder_id
                        else v_swap.requester_id end as to_owner
      from public.swap_items si
      join public.book_copies bc on bc.id = si.book_copy_id
     where si.swap_id = p_swap_id
  ),
  moved as (
    update public.book_copies bc
       set owner_id       = i.to_owner,
           custodian_id   = i.to_owner,   -- MVP: custody follows ownership
           status         = 'swapped',
           transfer_count = bc.transfer_count + 1
      from items i
     where bc.id = i.book_copy_id
    returning bc.id as copy_id, i.from_owner, i.to_owner
  ),
  events as (
    insert into public.ownership_events
      (book_copy_id, from_owner_id, to_owner_id, event_type, swap_id, actor_id, metadata)
    select m.copy_id, m.from_owner, m.to_owner, 'swap_transfer',
           p_swap_id, v_actor, jsonb_build_object('source','complete_swap')
      from moved m
    returning 1
  )
  select count(*) into v_moved from events;

  if v_moved <> v_items then
    raise exception 'TRANSFER_COUNT_MISMATCH' using errcode = '23514';
  end if;

  update public.swaps
     set status = 'COMPLETED', completed_at = now(), closed_at = now()
   where id = p_swap_id and status = 'CONFIRMED'
  returning * into v_swap;
  if not found then
    raise exception 'SWAP_STATE_CHANGED_CONCURRENTLY' using errcode = '40001';
  end if;

  perform private.write_audit(v_actor, 'swap.completed', 'swap', p_swap_id::text,
                              'success', jsonb_build_object('items', v_items));
  perform private.emit_event('swap_completed', 'swap', p_swap_id,
                             array[v_swap.requester_id, v_swap.responder_id], null);
  return v_swap;
end $$;

revoke all on function public.complete_swap(uuid) from public, anon;
grant execute on function public.complete_swap(uuid) to authenticated;

-- ── The hatch of last resort ──────────────────────────────────────────────

create or replace function public.admin_cancel_swap(p_swap_id uuid, p_reason text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := private.require_admin('swap.force_cancel', 'swap', p_swap_id::text);
  v_swap  public.swaps%rowtype;
begin
  select * into v_swap from public.swaps where id = p_swap_id for update;
  if not found then
    raise exception 'SWAP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_swap.status in ('COMPLETED','REJECTED','CANCELLED') then
    raise exception 'SWAP_IS_TERMINAL_%', v_swap.status using errcode = '23514';
  end if;

  update public.book_copies set status = 'available'
   where id in (select book_copy_id from public.swap_items where swap_id = p_swap_id)
     and status = 'reserved';

  update public.swaps
     set status = 'CANCELLED', confirmed_by = null, closed_at = now(), updated_at = now()
   where id = p_swap_id;

  perform private.write_audit(v_actor, 'swap.force_cancel', 'swap', p_swap_id::text,
                              'success', jsonb_build_object('from', v_swap.status,
                                                            'reason', p_reason));
  perform private.emit_event('swap_cancelled', 'swap', p_swap_id,
                             array[v_swap.requester_id, v_swap.responder_id], v_actor);
end $$;

revoke all on function public.admin_cancel_swap(uuid, text) from public, anon;
grant execute on function public.admin_cancel_swap(uuid, text) to authenticated;
