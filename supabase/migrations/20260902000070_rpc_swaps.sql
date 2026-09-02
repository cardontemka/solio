-- The three swap operations. Every one is SECURITY DEFINER with a pinned
-- search_path, takes only ids (never an owner or a status from the client),
-- and re-reads everything AFTER taking its locks.
--
-- Project-wide lock order — any future function touching swap state obeys it:
--   0. pg_advisory_xact_lock(hash('solio.swap:' || swap_id))
--   1. swaps       one row by PK              FOR UPDATE
--   2. book_copies N rows ORDER BY id ASC     FOR UPDATE
--   3. inserts into ownership_events / audit_logs / notifications
-- Level 1 before 2 prevents the deadlock of two swaps sharing a copy; the
-- ascending id at level 2 covers two *different* swaps sharing one.

-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.request_swap(
  p_offered_copy_id   uuid,
  p_requested_copy_id uuid,
  p_message           text default null)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_offered  public.book_copies%rowtype;
  v_requested public.book_copies%rowtype;
  v_swap_id uuid;
  v_recent int;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles
                  where id = v_actor and account_status = 'active') then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if p_offered_copy_id = p_requested_copy_id then
    raise exception 'SAME_COPY' using errcode = '23514';
  end if;

  select count(*) into v_recent from public.swaps
   where requester_id = v_actor and created_at > now() - interval '24 hours';
  if v_recent >= 20 then
    raise exception 'RATE_LIMIT_SWAP_REQUEST' using errcode = '54000';
  end if;

  -- Lock both copies in a deterministic order, then re-read them.
  perform 1 from public.book_copies
    where id in (p_offered_copy_id, p_requested_copy_id)
    order by id for update;

  select * into v_offered   from public.book_copies where id = p_offered_copy_id;
  select * into v_requested from public.book_copies where id = p_requested_copy_id;
  if v_offered.id is null or v_requested.id is null then
    raise exception 'COPY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_offered.owner_id <> v_actor then
    raise exception 'NOT_YOUR_COPY' using errcode = '42501';
  end if;
  if v_requested.owner_id = v_actor then
    raise exception 'CANNOT_SWAP_WITH_SELF' using errcode = '23514';
  end if;
  if v_offered.status <> 'available' or v_offered.moderation_status <> 'active' then
    raise exception 'OFFERED_COPY_UNAVAILABLE' using errcode = '23514';
  end if;
  if v_requested.status <> 'available' or v_requested.moderation_status <> 'active' then
    raise exception 'REQUESTED_COPY_UNAVAILABLE' using errcode = '23514';
  end if;

  -- One open request per (actor, requested copy): stops request spamming.
  if exists (
    select 1 from public.swaps s
      join public.swap_items si on si.swap_id = s.id
     where s.requester_id = v_actor
       and si.book_copy_id = p_requested_copy_id
       and si.side = 'requested'
       and s.status in ('REQUESTED','ACCEPTED','CONFIRMED')
  ) then
    raise exception 'DUPLICATE_OPEN_REQUEST' using errcode = '23505';
  end if;

  insert into public.swaps (requester_id, responder_id, message)
  values (v_actor, v_requested.owner_id, nullif(btrim(coalesce(p_message,'')),''))
  returning id into v_swap_id;

  insert into public.swap_items (swap_id, book_copy_id, side) values
    (v_swap_id, p_offered_copy_id,   'offered'),
    (v_swap_id, p_requested_copy_id, 'requested');

  perform private.write_audit(v_actor, 'swap.requested', 'swap', v_swap_id::text);
  perform private.emit_event('swap_requested', 'swap', v_swap_id,
                             array[v_requested.owner_id], v_actor);
  return v_swap_id;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
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

  -- Who may do what, per docs/transactions.md §2.1
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
    if v_swap.status not in ('REQUESTED','ACCEPTED') then
      -- Deliberately no CONFIRMED→CANCELLED edge: once a handover is asserted,
      -- unilateral cancellation would let someone take a book and back out.
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
    if v_swap.status = 'ACCEPTED' then
      update public.book_copies set status = 'available'
       where id in (select book_copy_id from public.swap_items where swap_id = p_swap_id)
         and status = 'reserved';
    end if;
    v_new_status := 'CANCELLED';
  end if;

  update public.swaps
     set status = v_new_status,
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

-- ══════════════════════════════════════════════════════════════════════════
-- The ONLY code path that changes book_copies.owner_id.
--   PHASE 1 (ACCEPTED  → CONFIRMED): first participant confirms handover.
--   PHASE 2 (CONFIRMED → COMPLETED): the OTHER participant confirms; ownership
--                                    transfers atomically.
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

  -- Re-validate ownership and status of every item AFTER the lock.
  perform 1
     from public.swap_items si
     join public.book_copies bc on bc.id = si.book_copy_id
    where si.swap_id = p_swap_id
      and (bc.status <> 'reserved'
        or bc.moderation_status = 'removed'
        or bc.owner_id <> case si.side when 'offered' then v_swap.requester_id
                                       else v_swap.responder_id end)
    limit 1;
  if found then
    raise exception 'OWNERSHIP_OR_STATUS_MISMATCH' using errcode = '23514',
      hint = 'A copy in this swap changed owner or status since it was confirmed.';
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

revoke all on function public.request_swap(uuid,uuid,text)  from public, anon;
revoke all on function public.respond_to_swap(uuid,text)    from public, anon;
revoke all on function public.complete_swap(uuid)           from public, anon;
grant execute on function public.request_swap(uuid,uuid,text) to authenticated;
grant execute on function public.respond_to_swap(uuid,text)   to authenticated;
grant execute on function public.complete_swap(uuid)          to authenticated;
