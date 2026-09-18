-- A donated book is on offer, not finished.
--
-- respond_to_claim marks every ownership transfer 'swapped', which is right for
-- a claim between two readers: the book has reached the person who wanted it and
-- nothing further is being offered. A donation to a storage point ends the
-- opposite way. The venue does not want the book — it is holding it out for
-- whoever turns up with a credit — so the moment the transfer lands, the copy is
-- available again, and from the shelf's point of view it has only just arrived.
--
-- Marked 'swapped', it fell out of every list that matters: the front page asks
-- for status = 'available', and so does countOwnedBy, which is the "N зүйл
-- байна" on each venue's card. Donating a book therefore made it disappear from
-- the site, and the only way to find it again was to know its code.
--
-- The transfer is still recorded in ownership_events either way; this changes
-- what the copy's *current* state says, not its history.

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
           -- A venue puts its new book straight back out; anybody else who
           -- takes one has what they came for, and the listing is closed.
           status = case when v_giving_to_point then 'available' else 'swapped' end,
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

-- The books already donated under the old rule, put back on the shelf they were
-- given to. A copy a venue owns is by definition a donation that landed: a venue
-- never registers a book of its own, and a copy it is merely holding for
-- somebody stays in that person's name and lives in copy_storage.
update public.book_copies bc
   set status = 'available'
 where bc.status = 'swapped'
   and exists (select 1 from public.storage_points sp where sp.profile_id = bc.owner_id)
   and not exists (select 1 from public.swap_items si
                    join public.swaps s on s.id = si.swap_id
                   where si.book_copy_id = bc.id
                     and s.status in ('REQUESTED','ACCEPTED','CONFIRMED'));

-- ── When did this become something you could take? ────────────────────────
-- The feed is ordered by created_at, which is when a copy was first registered.
-- For a book somebody has just donated that is the wrong date by months: the
-- copy is old, the offer is minutes old, and ordering by registration buries it
-- where nobody scrolls. The same is true of a listing its owner took down a year
-- ago and has just put back up.
--
-- listed_at is the date the feed actually means: the last time this copy became
-- available. Maintained in the guard trigger that already stamps updated_at, so
-- every path that reopens a listing gets it without knowing about it.

alter table public.book_copies add column if not exists listed_at timestamptz;
update public.book_copies set listed_at = created_at where listed_at is null;
alter table public.book_copies
  alter column listed_at set not null,
  alter column listed_at set default now();

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

  -- Back on offer, whoever put it there and by which route: a listing reopened
  -- by its owner, and also one that has just changed hands and is still open —
  -- which is the donation case, where the status never moves and only the name
  -- on it does. Same book, new offer, and the feed should say so.
  if new.status = 'available'
     and (old.status is distinct from 'available'
          or new.owner_id is distinct from old.owner_id) then
    new.listed_at := now();
  end if;

  new.updated_at := now();
  return new;
end $$;

-- Readable, never writable: it is a record of what the site did, not a field.
grant select (listed_at) on public.book_copies to anon, authenticated;

create index if not exists book_copies_listed_idx
  on public.book_copies (status, moderation_status, listed_at desc, id desc);

-- The donations that have already happened, dated when they actually happened
-- rather than when this migration ran.
update public.book_copies bc
   set listed_at = oe.occurred_at
  from (select distinct on (e.book_copy_id) e.book_copy_id, e.occurred_at
          from public.ownership_events e
         where e.event_type = 'claim_transfer'
           and (e.metadata->>'donation')::boolean is true
         order by e.book_copy_id, e.id desc) oe
 where oe.book_copy_id = bc.id
   and bc.status = 'available'
   and exists (select 1 from public.storage_points sp where sp.profile_id = bc.owner_id);
