-- Two changes to how a swap behaves in public.
--
-- 1. An offer is visible to everyone. Until now `swaps` was readable only by
--    its two participants, which is right for the negotiation but wrong for the
--    fact of it: somebody would offer a book, come back to its page later and
--    find no trace of having done so. The page could not say "three people have
--    offered for this" either, which is the single most useful thing a reader
--    can know about a listing they want.
--
--    Only pending offers are published, and only what is already public
--    anyway — which listing was put on the table, and by whom. Both are open
--    pages on this site. The message attached to a request stays private, as do
--    swaps that have been accepted and are being carried out.
--
-- 2. A swap cannot be cancelled by the people in it. Offering is a promise, and
--    a promise somebody can withdraw at will is not one; the site is small
--    enough that being stood up matters.
--
--    Two doors stay open, and both are about swaps that cannot proceed rather
--    than about changing your mind:
--
--      · the responder may still REJECT a request they have not accepted. That
--        is answering, not backing out.
--      · a swap that has become impossible — a book in it changed hands, went
--        in another swap, or was removed — can still be closed by either side.
--        Without that door the pair is stuck forever with nothing to click,
--        which is the exact deadlock 20260902000470 was written to remove.
--
--    An admin can still force one closed.

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
    if v_swap.status not in ('REQUESTED','ACCEPTED','CONFIRMED') then
      raise exception 'INVALID_TRANSITION_%_TO_CANCELLED', v_swap.status
        using errcode = '23514';
    end if;
    -- The only reason left to cancel: the swap can no longer be carried out.
    -- Changing your mind is not one of them.
    if private.swap_is_fulfillable(p_swap_id) then
      raise exception 'SWAPS_ARE_NOT_CANCELLED' using errcode = '42501';
    end if;
  end if;

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

-- ── Who has offered for this listing ─────────────────────────────────────
-- SECURITY DEFINER because `swaps` is participant-only and should stay that
-- way; this publishes the two facts that are already public — which listing was
-- offered, and who by — and nothing else. The message the requester wrote is
-- not among them.

create or replace function public.list_open_offers(p_copy_id uuid)
returns table (
  swap_id            uuid,
  offered_copy_id    uuid,
  offered_title      text,
  offered_author     text,
  offered_kind       text,
  offered_cover_key  text,
  requester_id       uuid,
  requester_username text,
  requester_name     text,
  created_at         timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.id,
         oc.id,
         ob.title,
         ob.author,
         ob.kind::text,
         (select coalesce(i.thumb_key, i.storage_key)
            from public.book_images i
           where i.book_copy_id = oc.id and i.status = 'ready'
           order by i.sort_order
           limit 1),
         p.id,
         p.username,
         p.display_name,
         s.created_at
    from public.swaps s
    join public.swap_items si_req
      on si_req.swap_id = s.id and si_req.side = 'requested'
     and si_req.book_copy_id = p_copy_id
    join public.swap_items si_off
      on si_off.swap_id = s.id and si_off.side = 'offered'
    join public.book_copies oc on oc.id = si_off.book_copy_id
    join public.books      ob on ob.id = oc.book_id
    join public.profiles   p  on p.id = s.requester_id
   where s.status = 'REQUESTED'
     and oc.moderation_status = 'active'
     and ob.moderation_status = 'active'
     and p.account_status = 'active'
   order by s.created_at;
$$;

revoke all on function public.list_open_offers(uuid) from public;
grant execute on function public.list_open_offers(uuid) to anon, authenticated;
