-- Who has the thing is a fact, not a setting.
--
-- Until now an owner could tick a box saying "this is at the café", which made
-- the one claim this site makes — here is who has this book — something anybody
-- could assert about themselves. Location is now only ever the consequence of a
-- venue saying "I have it" and the owner agreeing, which is the same handshake
-- that moves ownership. The picker is gone and so is the function behind it.
--
-- And giving a book to a storage point is not the same act as leaving one there:
--
--   donation  — the venue takes ownership. The book is the venue's to give away
--               now, and the donor gets one credit: the right to walk into any
--               storage point and take any book. No swap, no counterparty.
--
--   storage   — the venue holds the book for its owner. Nothing changes hands
--               and no credit is earned; this is the service that lets two
--               people swap without meeting, by leaving a book at a counter.
--
-- The difference is visible in the ledger: a donation writes an ownership_event
-- and a credit, storage writes neither.

drop function if exists public.set_stored_at(uuid, uuid);

-- ── Credits ───────────────────────────────────────────────────────────────
-- An append-only ledger rather than a counter on profiles. A balance that is
-- only ever a SUM cannot drift, and "where did my credit go" is answerable.

create table public.credit_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  delta      int  not null check (delta <> 0 and delta between -10 and 10),
  reason     text not null check (reason in ('donation', 'redemption', 'adjustment')),
  copy_id    uuid references public.book_copies(id) on delete set null,
  claim_id   uuid references public.copy_claims(id) on delete set null,
  note       text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now()
);

create index credit_events_user_idx on public.credit_events (user_id, created_at desc);

alter table public.credit_events enable row level security;
grant select on public.credit_events to authenticated;

create policy credit_events_select_own on public.credit_events
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_staff());

-- Append-only, like every other ledger here.
create or replace function private.credit_events_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if private.history_override() then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception 'CREDIT_LEDGER_IS_APPEND_ONLY' using errcode = '42501';
end $$;

create trigger credit_events_guard_trg
  before update or delete on public.credit_events
  for each row execute function private.credit_events_guard();

create or replace function private.credit_balance(p_user uuid) returns int
language sql stable set search_path = ''
as $$
  select coalesce(sum(delta), 0)::int from public.credit_events where user_id = p_user
$$;

/** The caller's own balance, for the pages that show it. */
create or replace function public.my_credit_balance() returns int
language sql stable security definer set search_path = ''
as $$
  select private.credit_balance((select auth.uid()))
$$;
revoke all on function public.my_credit_balance() from public, anon;
grant execute on function public.my_credit_balance() to authenticated;

-- ── The shell carries it ──────────────────────────────────────────────────

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
    (select count(*)::int from public.notifications n
      where n.user_id = p.id and n.read_at is null),
    private.credit_balance(p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = (select auth.uid())
$$;

revoke all     on function public.session_context() from public;
grant  execute on function public.session_context() to anon, authenticated;

-- ── Approving a claim, with the two economies it can touch ────────────────

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

  -- ── Approval ────────────────────────────────────────────────────────────
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
    update public.book_copies bc
       set stored_at = v_point, stored_since = now()
     where bc.id = v_copy.id;
  else
    -- Who is on each side decides whether a credit moves.
    v_giving_to_point := exists (select 1 from public.storage_points sp
                                  where sp.profile_id = v_claim.claimant_id);
    v_taking_from_point := exists (select 1 from public.storage_points sp
                                    where sp.profile_id = v_claim.owner_id);

    -- Taking a book off a storage point's shelf is what a credit is for. The
    -- balance is checked here, under the claim's row lock, rather than when the
    -- claim was raised: days may have passed and credits may have been spent.
    if v_taking_from_point then
      v_balance := private.credit_balance(v_claim.claimant_id);
      if v_balance < 1 then
        raise exception 'NOT_ENOUGH_CREDITS' using errcode = '23514';
      end if;
      insert into public.credit_events (user_id, delta, reason, copy_id, claim_id)
      values (v_claim.claimant_id, -1, 'redemption', v_copy.id, p_claim_id);
    end if;

    -- Giving one to a storage point earns the donor exactly one, whatever the
    -- book is. Valuing books against each other is a judgement this site has no
    -- business making, and one-for-one is the rule people can hold in their head.
    if v_giving_to_point then
      insert into public.credit_events (user_id, delta, reason, copy_id, claim_id)
      values (v_claim.owner_id, 1, 'donation', v_copy.id, p_claim_id);
    end if;

    update public.book_copies bc
       set owner_id = v_claim.claimant_id,
           custodian_id = v_claim.claimant_id,
           status = 'swapped',
           transfer_count = bc.transfer_count + 1,
           -- Wherever it was being kept, it is with its new owner now. A venue
           -- that has just been given a book holds it as owner, not as keeper.
           stored_at = null,
           stored_since = null
     where bc.id = v_copy.id;

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

-- ── Handing a stored book back ────────────────────────────────────────────
-- The counterpart of a storage claim, and deliberately the venue's to make: the
-- owner cannot say where their book is, including that it is no longer at the
-- café. Whoever is holding it is who knows.

create or replace function public.release_stored(p_copy_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_point uuid;
  v_copy  public.book_copies%rowtype;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select sp.id into v_point from public.storage_points sp where sp.profile_id = v_actor;
  if v_point is null then
    raise exception 'NOT_A_STORAGE_POINT' using errcode = '42501';
  end if;

  select * into v_copy from public.book_copies where id = p_copy_id for update;
  if not found then
    raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_copy.stored_at is distinct from v_point then
    raise exception 'NOT_STORED_HERE' using errcode = '42501';
  end if;

  update public.book_copies bc
     set stored_at = null, stored_since = null
   where bc.id = p_copy_id;

  perform private.write_audit(v_actor, 'listing.released', 'book_copy', p_copy_id::text,
                              'success', jsonb_build_object('storage_point', v_point));
end $$;

revoke all on function public.release_stored(uuid) from public, anon;
grant execute on function public.release_stored(uuid) to authenticated;

-- ── What a claim will cost, before it is raised ───────────────────────────
-- The scan page has to say "this takes one of your credits" before the button
-- is pressed, and it cannot read another account's credit rules from the client.

create or replace function public.claim_options(p_code text)
returns table (
  copy_id             uuid,
  owner_is_point      boolean,
  viewer_is_point     boolean,
  viewer_credits      int,
  ownership_costs     int,
  ownership_earns     int)
language sql stable security definer set search_path = ''
as $$
  select c.id,
         exists (select 1 from public.storage_points sp where sp.profile_id = c.owner_id),
         exists (select 1 from public.storage_points sp where sp.profile_id = (select auth.uid())),
         private.credit_balance((select auth.uid())),
         case when exists (select 1 from public.storage_points sp
                            where sp.profile_id = c.owner_id) then 1 else 0 end,
         case when exists (select 1 from public.storage_points sp
                            where sp.profile_id = (select auth.uid())) then 1 else 0 end
    from public.book_copies c
   where c.public_code = public.normalize_item_code(p_code)
     and c.moderation_status = 'active';
$$;
revoke all on function public.claim_options(text) from public, anon;
grant execute on function public.claim_options(text) to authenticated;

-- ── Reading claims, now that both sides can be venues ─────────────────────
-- `other_point` was ambiguous: it joined the claimant's venue whichever side
-- the reader was on, so a café looking at its own claim saw its own name where
-- the counterparty belonged. Both sides are named instead, and the wording —
-- donated, stored, taken — follows from which of them is set.

drop function if exists public.list_my_claims();

create function public.list_my_claims()
returns table (
  claim_id       uuid,
  copy_id        uuid,
  public_code    text,
  title          text,
  author         text,
  item_kind      text,
  cover_key      text,
  kind           text,
  status         text,
  note           text,
  created_at     timestamptz,
  expires_at     timestamptz,
  role           text,
  other_id       uuid,
  other_name     text,
  other_user     text,
  claimant_point text,
  owner_point    text)
language sql stable security definer set search_path = ''
as $$
  select cc.id, cc.copy_id, c.public_code, b.title, b.author, b.kind::text,
         (select bi.thumb_key from public.book_images bi
           where bi.book_copy_id = c.id and bi.status = 'ready'
           order by bi.sort_order limit 1),
         cc.kind::text,
         -- A pending claim past its date is expired whether or not a write has
         -- caught up with it; saying "waiting" would be a lie with a deadline.
         case when cc.status = 'pending' and cc.expires_at <= now()
              then 'expired' else cc.status::text end,
         cc.note, cc.created_at, cc.expires_at,
         case when cc.owner_id = (select auth.uid()) then 'owner' else 'claimant' end,
         other.id, other.display_name, other.username,
         cp.name, op.name
    from public.copy_claims cc
    join public.book_copies c on c.id = cc.copy_id
    join public.books b       on b.id = c.book_id
    join public.profiles other
      on other.id = case when cc.owner_id = (select auth.uid())
                         then cc.claimant_id else cc.owner_id end
    left join public.storage_points cp on cp.profile_id = cc.claimant_id
    left join public.storage_points op on op.profile_id = cc.owner_id
   where (select auth.uid()) in (cc.owner_id, cc.claimant_id)
   order by cc.created_at desc, cc.id desc
   limit 100;
$$;
revoke all on function public.list_my_claims() from public, anon;
grant execute on function public.list_my_claims() to authenticated;
