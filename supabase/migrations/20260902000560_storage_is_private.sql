-- Where somebody's book is being kept is not public.
--
-- It was: the shelf pointer was a column on book_copies, so it rode along in
-- every listing query — a card in the feed said "📍 Номын Кафе" to anybody, and
-- a venue's page listed every book on its shelves to the street. That is a
-- standing invitation: here is a specific object, here is the address it is
-- sitting at, and here is when it arrived.
--
-- Three parties have a reason to know, and nobody else does:
--   • the owner, whose book it is;
--   • the venue, which is holding it;
--   • the counterparty of a live swap this handover is for — the person who is
--     going to walk in and collect it.
-- Staff too, because moderation has to see what it is moderating.
--
-- ── Why a table rather than a column privilege ────────────────────────────
-- The obvious move is `revoke select (stored_at) on book_copies`. It does
-- nothing: Postgres keeps table-level and column-level grants separately, and a
-- role holding SELECT on the table still reads every column. Making it work
-- means revoking the table grant and re-granting every *other* column by name —
-- a list that silently goes wrong the next time a column is added.
--
-- A separate table carries its own RLS, needs no enumeration, and stays correct
-- when book_copies grows. It also says what is true: this is a fact about a
-- relationship between two parties, not an attribute of the object.

create table public.copy_storage (
  copy_id  uuid primary key references public.book_copies(id)    on delete cascade,
  point_id uuid not null    references public.storage_points(id) on delete cascade,
  since    timestamptz not null default now()
);

create index copy_storage_point_idx on public.copy_storage (point_id, since desc);

insert into public.copy_storage (copy_id, point_id, since)
select id, stored_at, coalesce(stored_since, now())
  from public.book_copies
 where stored_at is not null;

alter table public.book_copies
  drop constraint book_copies_stored_stamp,
  drop column stored_at,
  drop column stored_since;

alter table public.copy_storage enable row level security;
-- Not granted to anon at all: there is no reading of this table without an
-- account, and no policy that would let one through.
grant select on public.copy_storage to authenticated;

create policy copy_storage_select_involved on public.copy_storage
  for select to authenticated
  using (
    exists (select 1 from public.book_copies c
             where c.id = copy_id and c.owner_id = (select auth.uid()))
    or exists (select 1 from public.storage_points sp
                where sp.id = point_id and sp.profile_id = (select auth.uid()))
    or private.is_staff()
    or exists (select 1
                 from public.swap_items si
                 join public.swaps s on s.id = si.swap_id
                where si.book_copy_id = copy_id
                  and s.status in ('ACCEPTED', 'CONFIRMED')
                  and (select auth.uid()) in (s.requester_id, s.responder_id))
  );

-- No write grants: every change still goes through the claim flow below.
create or replace function private.copy_storage_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if private.is_privileged_context() then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception 'STORAGE_IS_SET_BY_FUNCTION' using errcode = '42501',
    hint = 'Storage changes through respond_to_claim() and release_stored().';
end $$;

create trigger copy_storage_guard_trg
  before insert or update or delete on public.copy_storage
  for each row execute function private.copy_storage_guard();

-- ── The guard on book_copies loses a column it was protecting ─────────────

create or replace function private.book_copies_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.history_override() then return old; end if;
    if old.owner_id = (select auth.uid()) then return old; end if;
    raise exception 'NOT_YOUR_LISTING' using errcode = '42501';
  end if;

  if not private.is_privileged_context() then
    if new.owner_id is distinct from old.owner_id
       or new.custodian_id is distinct from old.custodian_id then
      raise exception 'OWNERSHIP_CHANGE_FORBIDDEN' using errcode = '42501',
        hint = 'Ownership changes only through the swap and claim flows.';
    end if;
    if new.book_id is distinct from old.book_id
       or new.created_at is distinct from old.created_at
       or new.transfer_count is distinct from old.transfer_count
       or new.public_code is distinct from old.public_code then
      raise exception 'COPY_IMMUTABLE_FIELD' using errcode = '23514';
    end if;
    if new.moderation_status is distinct from old.moderation_status then
      raise exception 'MODERATION_IS_STAFF_ONLY' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and (old.status, new.status) not in
           (('available','inactive'), ('inactive','available'),
            ('swapped','available'),  ('swapped','inactive')) then
      raise exception 'INVALID_COPY_TRANSITION_%_TO_%', old.status, new.status
        using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- ── Everything that read or wrote the old columns ─────────────────────────

create or replace function public.respond_to_claim(p_claim_id uuid, p_action text)
returns public.copy_claims
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_claim  public.copy_claims%rowtype;
  v_copy   public.book_copies%rowtype;
  v_point  uuid;
  v_taking_from_point boolean;
  v_giving_to_point   boolean;
  v_balance int;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_action not in ('approve', 'reject', 'cancel') then
    raise exception 'UNKNOWN_CLAIM_ACTION' using errcode = '23514';
  end if;

  select * into v_claim from public.copy_claims where id = p_claim_id for update;
  if not found then
    raise exception 'CLAIM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'CLAIM_ALREADY_RESOLVED' using errcode = '23514';
  end if;
  if v_claim.expires_at <= now() then
    update public.copy_claims cc set status = 'expired', resolved_at = now()
     where cc.id = p_claim_id;
    raise exception 'CLAIM_EXPIRED' using errcode = '23514';
  end if;

  if p_action = 'cancel' then
    if v_claim.claimant_id <> v_actor then
      raise exception 'ONLY_CLAIMANT_MAY_CANCEL' using errcode = '42501';
    end if;
  elsif v_claim.owner_id <> v_actor then
    raise exception 'ONLY_OWNER_MAY_DECIDE' using errcode = '42501';
  end if;

  select * into v_copy from public.book_copies where id = v_claim.copy_id for update;
  if not found then
    raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_action <> 'approve' then
    update public.copy_claims cc
       set status = case p_action when 'reject' then 'rejected' else 'cancelled' end,
           resolved_at = now(), resolved_by = v_actor
     where cc.id = p_claim_id
    returning * into v_claim;

    perform private.write_audit(v_actor, 'claim.' || p_action, 'book_copy',
                                v_claim.copy_id::text, 'success',
                                jsonb_build_object('claim', p_claim_id));
    if p_action = 'reject' then
      perform private.emit_event('claim_rejected', 'book_copy', v_claim.copy_id,
                                 array[v_claim.claimant_id], v_actor,
                                 jsonb_build_object('claim', p_claim_id));
    end if;
    return v_claim;
  end if;

  if v_copy.owner_id <> v_claim.owner_id then
    raise exception 'OWNERSHIP_CHANGED_SINCE_CLAIM' using errcode = '23514';
  end if;
  if v_copy.status = 'reserved' then
    raise exception 'ITEM_IN_ACTIVE_SWAP' using errcode = '23514';
  end if;

  if v_claim.kind = 'storage' then
    select sp.id into v_point from public.storage_points sp
     where sp.profile_id = v_claim.claimant_id;
    if v_point is null then
      raise exception 'NOT_A_STORAGE_POINT' using errcode = '42501';
    end if;
    -- Custody only. Nothing is owed to anybody: this is the venue doing the
    -- owner a favour, not a transaction.
    insert into public.copy_storage (copy_id, point_id, since)
    values (v_copy.id, v_point, now())
    on conflict (copy_id) do update set point_id = excluded.point_id, since = now();
  else
    v_giving_to_point := exists (select 1 from public.storage_points sp
                                  where sp.profile_id = v_claim.claimant_id);
    v_taking_from_point := exists (select 1 from public.storage_points sp
                                    where sp.profile_id = v_claim.owner_id);

    if v_taking_from_point then
      v_balance := private.credit_balance(v_claim.claimant_id);
      if v_balance < 1 then
        raise exception 'NOT_ENOUGH_CREDITS' using errcode = '23514';
      end if;
      insert into public.credit_events (user_id, delta, reason, copy_id, claim_id)
      values (v_claim.claimant_id, -1, 'redemption', v_copy.id, p_claim_id);
    end if;

    if v_giving_to_point then
      insert into public.credit_events (user_id, delta, reason, copy_id, claim_id)
      values (v_claim.owner_id, 1, 'donation', v_copy.id, p_claim_id);
    end if;

    update public.book_copies bc
       set owner_id = v_claim.claimant_id,
           custodian_id = v_claim.claimant_id,
           status = 'swapped',
           transfer_count = bc.transfer_count + 1
     where bc.id = v_copy.id;

    -- It is in the new owner's hands now, wherever it was before.
    delete from public.copy_storage where copy_id = v_copy.id;

    insert into public.ownership_events
      (book_copy_id, from_owner_id, to_owner_id, event_type, actor_id, metadata)
    values (v_copy.id, v_claim.owner_id, v_claim.claimant_id, 'claim_transfer', v_actor,
            jsonb_build_object('source', 'claim', 'claim', p_claim_id,
                               'donation', coalesce(v_giving_to_point, false),
                               'redemption', coalesce(v_taking_from_point, false)));
  end if;

  update public.copy_claims cc
     set status = 'approved', resolved_at = now(), resolved_by = v_actor
   where cc.id = p_claim_id
  returning * into v_claim;

  perform private.write_audit(v_actor, 'claim.approved', 'book_copy', v_copy.id::text,
                              'success', jsonb_build_object('claim', p_claim_id,
                                                            'kind', v_claim.kind));
  perform private.emit_event('claim_approved', 'book_copy', v_copy.id,
                             array[v_claim.claimant_id], v_actor,
                             jsonb_build_object('claim', p_claim_id, 'kind', v_claim.kind));
  return v_claim;
end $$;

revoke all on function public.respond_to_claim(uuid, text) from public, anon;
grant execute on function public.respond_to_claim(uuid, text) to authenticated;

create or replace function public.release_stored(p_copy_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_point uuid;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select sp.id into v_point from public.storage_points sp where sp.profile_id = v_actor;
  if v_point is null then
    raise exception 'NOT_A_STORAGE_POINT' using errcode = '42501';
  end if;

  if not exists (select 1 from public.copy_storage cs
                  where cs.copy_id = p_copy_id and cs.point_id = v_point) then
    raise exception 'NOT_STORED_HERE' using errcode = '42501';
  end if;

  delete from public.copy_storage where copy_id = p_copy_id;

  perform private.write_audit(v_actor, 'listing.released', 'book_copy', p_copy_id::text,
                              'success', jsonb_build_object('storage_point', v_point));
end $$;

revoke all on function public.release_stored(uuid) from public, anon;
grant execute on function public.release_stored(uuid) to authenticated;

-- A completed swap takes the book off whatever shelf it was waiting on.
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
           transfer_count = bc.transfer_count + 1
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

  -- A book that was waiting at a storage point for this handover has now been
  -- collected; leaving the shelf row behind would have the new owner's book
  -- listed as sitting in somebody else's café.
  delete from public.copy_storage
   where copy_id in (select book_copy_id from public.swap_items where swap_id = p_swap_id);

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

-- ── Reading it ────────────────────────────────────────────────────────────
-- These stay SECURITY DEFINER so they can join in the venue's name and address,
-- but they select *through* copy_storage's policy by checking the same rule,
-- so a change to who may know lives in one place: the policy above.

create or replace function private.may_see_storage(p_copy_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.copy_storage cs where cs.copy_id = p_copy_id
      and (
        exists (select 1 from public.book_copies c
                 where c.id = cs.copy_id and c.owner_id = (select auth.uid()))
        or exists (select 1 from public.storage_points sp
                    where sp.id = cs.point_id and sp.profile_id = (select auth.uid()))
        or private.is_staff()
        or exists (select 1
                     from public.swap_items si
                     join public.swaps s on s.id = si.swap_id
                    where si.book_copy_id = cs.copy_id
                      and s.status in ('ACCEPTED', 'CONFIRMED')
                      and (select auth.uid()) in (s.requester_id, s.responder_id))
      )
  )
$$;

create or replace function public.storage_for_copies(p_copy_ids uuid[])
returns table (
  copy_id      uuid,
  point_id     uuid,
  username     text,
  name         text,
  kind         text,
  city         text,
  district     text,
  address      text,
  stored_since timestamptz)
language sql stable security definer set search_path = ''
as $$
  select cs.copy_id, sp.id, p.username, sp.name, sp.kind::text, sp.city, sp.district,
         sp.address, cs.since
    from public.copy_storage cs
    join public.storage_points sp on sp.id = cs.point_id
    join public.profiles p on p.id = sp.profile_id
   where cs.copy_id = any(p_copy_ids)
     and (select auth.uid()) is not null
     and private.may_see_storage(cs.copy_id);
$$;
revoke all on function public.storage_for_copies(uuid[]) from public, anon;
grant execute on function public.storage_for_copies(uuid[]) to authenticated;

create or replace function public.my_stored_copies()
returns table (copy_id uuid, stored_since timestamptz)
language sql stable security definer set search_path = ''
as $$
  select cs.copy_id, cs.since
    from public.copy_storage cs
    join public.storage_points sp on sp.id = cs.point_id
   where sp.profile_id = (select auth.uid())
   order by cs.since desc;
$$;
revoke all on function public.my_stored_copies() from public, anon;
grant execute on function public.my_stored_copies() to authenticated;

create or replace function public.find_copy_by_code(p_code text)
returns table (
  copy_id        uuid,
  public_code    text,
  title          text,
  author         text,
  kind           text,
  status         text,
  cover_key      text,
  owner_id       uuid,
  owner_name     text,
  owner_username text,
  stored_at_name text,
  has_open_claim boolean)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.public_code, b.title, b.author, b.kind::text, c.status::text,
         (select bi.thumb_key from public.book_images bi
           where bi.book_copy_id = c.id and bi.status = 'ready'
           order by bi.sort_order limit 1),
         c.owner_id, p.display_name, p.username,
         -- The code is on the object, so whoever scans it is holding the thing —
         -- but a code can be photographed, and where it is kept is exactly what
         -- this migration takes off the street.
         case when private.may_see_storage(c.id)
              then (select sp.name from public.copy_storage cs
                      join public.storage_points sp on sp.id = cs.point_id
                     where cs.copy_id = c.id) end,
         exists (select 1 from public.copy_claims cc
                  where cc.copy_id = c.id and cc.status = 'pending'
                    and cc.expires_at > now())
    from public.book_copies c
    join public.books b    on b.id = c.book_id
    join public.profiles p on p.id = c.owner_id
   where c.public_code = public.normalize_item_code(p_code)
     and c.moderation_status = 'active'
     and p.account_status = 'active';
$$;
revoke all on function public.find_copy_by_code(text) from public;
grant execute on function public.find_copy_by_code(text) to anon, authenticated;
