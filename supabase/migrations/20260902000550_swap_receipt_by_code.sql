-- Handing a book over is confirmed by the book, not by a button.
--
-- Until now each side pressed "I received it" on a page, which is a promise
-- about the physical world made by somebody who might be anywhere. The label on
-- the object is the evidence: you can only scan it if it is in your hands. So
-- the confirm button becomes a scan, and the scan is the only way to confirm.
--
-- The state machine underneath is unchanged (docs/transactions.md §2.1):
-- ACCEPTED → CONFIRMED by the first receiver, → COMPLETED when the second one
-- confirms, and the ownership transfer still happens in one statement with its
-- ledger entries. What changes is who may trigger each step and what they must
-- be holding to do it.

-- The body of the old complete_swap, moved somewhere only a checked caller can
-- reach it. public.complete_swap is dropped below: a swap can no longer be
-- advanced by knowing its id.
create or replace function private.advance_swap(p_swap_id uuid, p_actor uuid)
returns public.swaps
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_swap  public.swaps%rowtype;
  v_other uuid;
  v_items int;
  v_locked int;
  v_moved int;
begin
  if not exists (select 1 from public.profiles
                  where id = p_actor and account_status = 'active') then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('solio.swap:' || p_swap_id::text, 0));

  select * into v_swap from public.swaps where id = p_swap_id for update;
  if not found then
    raise exception 'SWAP_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_actor not in (v_swap.requester_id, v_swap.responder_id) then
    raise exception 'NOT_A_PARTICIPANT' using errcode = '42501';
  end if;
  v_other := case when p_actor = v_swap.requester_id
                  then v_swap.responder_id else v_swap.requester_id end;

  ---------------------------------------------------------------- PHASE 1
  if v_swap.status = 'ACCEPTED' then
    update public.swaps set status = 'CONFIRMED', confirmed_by = p_actor
     where id = p_swap_id and status = 'ACCEPTED'
    returning * into v_swap;
    if not found then
      raise exception 'SWAP_STATE_CHANGED_CONCURRENTLY' using errcode = '40001';
    end if;
    perform private.write_audit(p_actor, 'swap.confirmed', 'swap', p_swap_id::text);
    perform private.emit_event('swap_confirmed', 'swap', p_swap_id,
                               array[v_other], p_actor);
    return v_swap;
  end if;

  ---------------------------------------------------------------- PHASE 2
  if v_swap.status <> 'CONFIRMED' then
    raise exception 'INVALID_TRANSITION_%_TO_COMPLETED', v_swap.status
      using errcode = '23514';
  end if;
  if v_swap.confirmed_by = p_actor then
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

  if not private.swap_is_fulfillable(p_swap_id) then
    raise exception 'OWNERSHIP_OR_STATUS_MISMATCH' using errcode = '23514',
      hint = 'A copy in this swap changed owner, was removed, or is in another swap.';
  end if;

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
           custodian_id   = i.to_owner,
           status         = 'swapped',
           transfer_count = bc.transfer_count + 1,
           -- A book that was waiting at a storage point for this handover has
           -- now been collected; leaving the shelf pointer behind would have
           -- the new owner's book listed as sitting in somebody else's café.
           stored_at      = null,
           stored_since   = null
      from items i
     where bc.id = i.book_copy_id
    returning bc.id as copy_id, i.from_owner, i.to_owner
  ),
  events as (
    insert into public.ownership_events
      (book_copy_id, from_owner_id, to_owner_id, event_type, swap_id, actor_id, metadata)
    select m.copy_id, m.from_owner, m.to_owner, 'swap_transfer',
           p_swap_id, p_actor, jsonb_build_object('source','scan')
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

  perform private.write_audit(p_actor, 'swap.completed', 'swap', p_swap_id::text,
                              'success', jsonb_build_object('items', v_items));
  perform private.emit_event('swap_completed', 'swap', p_swap_id,
                             array[v_swap.requester_id, v_swap.responder_id], null);
  return v_swap;
end $$;

-- Nobody may advance a swap by id any more.
drop function if exists public.complete_swap(uuid);

/**
 * "This book is in my hands now."
 *
 * The code identifies a physical object, the swap says who was due to receive
 * it, and the two together are the confirmation. Scanning your own book — the
 * one you are giving away — proves nothing and is refused: the check is that
 * the caller is the *receiving* side for this particular copy.
 */
create or replace function public.confirm_receipt_by_code(p_code text)
returns public.swaps
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_copy     public.book_copies%rowtype;
  v_swap_id  uuid;
  v_receiver uuid;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_copy from public.book_copies bc
   where bc.public_code = public.normalize_item_code(p_code);
  if not found then
    raise exception 'ITEM_CODE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select s.id,
         case si.side when 'offered' then s.responder_id else s.requester_id end
    into v_swap_id, v_receiver
    from public.swap_items si
    join public.swaps s on s.id = si.swap_id
   where si.book_copy_id = v_copy.id
     and s.status in ('ACCEPTED', 'CONFIRMED')
   order by s.created_at desc
   limit 1;

  if v_swap_id is null then
    raise exception 'NO_ACTIVE_SWAP_FOR_ITEM' using errcode = 'P0002';
  end if;
  if v_receiver <> v_actor then
    raise exception 'NOT_THE_RECEIVING_SIDE' using errcode = '42501';
  end if;

  return private.advance_swap(v_swap_id, v_actor);
end $$;

revoke all on function public.confirm_receipt_by_code(text) from public, anon;
grant execute on function public.confirm_receipt_by_code(text) to authenticated;

/**
 * What a scanned code means for a swap in flight, so the page can say it before
 * anything is pressed. Returns nothing when this code has no live swap, which
 * is the ordinary case.
 */
create or replace function public.swap_receipt_for_code(p_code text)
returns table (
  swap_id        uuid,
  copy_id        uuid,
  title          text,
  status         text,
  viewer_receives boolean,
  viewer_confirmed boolean,
  other_name     text,
  other_username text)
language sql stable security definer set search_path = ''
as $$
  select s.id, c.id, b.title, s.status::text,
         (case si.side when 'offered' then s.responder_id else s.requester_id end)
           = (select auth.uid()),
         s.confirmed_by is not distinct from (select auth.uid()),
         p.display_name, p.username
    from public.book_copies c
    join public.books b   on b.id = c.book_id
    join public.swap_items si on si.book_copy_id = c.id
    join public.swaps s   on s.id = si.swap_id
    join public.profiles p
      on p.id = case when s.requester_id = (select auth.uid())
                     then s.responder_id else s.requester_id end
   where c.public_code = public.normalize_item_code(p_code)
     and s.status in ('ACCEPTED', 'CONFIRMED')
     and (select auth.uid()) in (s.requester_id, s.responder_id)
   order by s.created_at desc
   limit 1;
$$;
revoke all on function public.swap_receipt_for_code(text) from public, anon;
grant execute on function public.swap_receipt_for_code(text) to authenticated;

-- An item promised to a live swap already refuses claims (ITEM_IN_ACTIVE_SWAP).
-- That stays: the scan of a book in a swap means "I received it", never "it is
-- mine now" — the swap itself is what moves it.
