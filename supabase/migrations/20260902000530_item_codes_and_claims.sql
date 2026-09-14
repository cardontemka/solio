-- Every physical thing gets a permanent code, and changing hands becomes a
-- claim somebody else raises and the owner approves.
--
-- ── Why the code is permanent, not per-handover ───────────────────────────
-- The alternative considered was a session code: the owner's phone shows a QR,
-- the receiver scans it, the code dies with the handover. It reads as the safer
-- design and it fails at the one moment this feature exists for. A storage
-- point receives a book when the owner is *not there* — dropping it off and
-- leaving is the entire point of a storage point — so a code that lives on the
-- owner's screen cannot be scanned by the café, and a café cannot re-identify
-- the book on its shelf a week later either.
--
-- A permanent code is a property of the object, like a title page. It gets
-- printed once, stuck inside the cover, and answers "what is this?" for anyone
-- holding the book, forever, with no session to coordinate.
--
-- The obvious objection — anyone who sees the code can claim the item — is
-- answered by the approval step rather than by secrecy: a claim moves nothing
-- until the owner says so, and an unwanted claim is a notification, not a loss.
-- Sessions come back in a different place, where they are cheap: the *claim*
-- expires, and only one can be open at a time.
--
-- The QR encodes a URL (/t/<code>), so a phone's own camera opens it. No app,
-- no in-page scanner to fail on iOS.

-- ── The code ──────────────────────────────────────────────────────────────
-- Crockford's alphabet: no I, L, O or U, so nothing in it can be misread from
-- a label or misheard over a telephone. 32^8 ≈ 1.1e12 — guessing is pointless
-- against the approval step anyway, but it also costs an attacker everything.

create or replace function private.new_item_code() returns text
language plpgsql volatile set search_path = ''
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea;
  v_code text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      -- 256 is not a multiple of 32, but 32 divides it exactly, so masking the
      -- low five bits keeps every symbol equally likely.
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) & 31), 1);
    end loop;
    exit when not exists (select 1 from public.book_copies where public_code = v_code);
  end loop;
  return v_code;
end $$;

/**
 * Typed-in codes arrive with dashes, spaces, lower case and the letters people
 * substitute for digits. All of that is the same code.
 *
 * A whole scanned URL is also the same code: phones hand people links, and
 * pasting one into the box is the obvious thing to try. Everything up to the
 * last slash is dropped before the rest is cleaned up, so
 * "https://solio.mn/t/WPM8RCEF" and "wpm8-rcef" both arrive as one code.
 */
create or replace function public.normalize_item_code(p_code text) returns text
language sql immutable set search_path = ''
as $$
  select translate(
           upper(regexp_replace(
             regexp_replace(split_part(split_part(coalesce(p_code, ''), '?', 1), '#', 1),
                            '^.*/', ''),
             '[^0-9A-Za-z]', '', 'g')),
           'ILO', '110')
$$;
grant execute on function public.normalize_item_code(text) to anon, authenticated;

alter table public.book_copies add column public_code text;

update public.book_copies set public_code = private.new_item_code() where public_code is null;

alter table public.book_copies
  alter column public_code set not null,
  alter column public_code set default private.new_item_code(),
  add constraint book_copies_public_code_shape check (public_code ~ '^[0-9A-HJKMNP-TV-Z]{8}$');

create unique index book_copies_public_code_key on public.book_copies (public_code);

-- ── The claim ─────────────────────────────────────────────────────────────

create domain public.claim_kind as text
  constraint claim_kind_values check (value in ('storage', 'ownership'));

create domain public.claim_status as text
  constraint claim_status_values
  check (value in ('pending', 'approved', 'rejected', 'expired', 'cancelled'));

create table public.copy_claims (
  id          uuid primary key default gen_random_uuid(),
  copy_id     uuid not null references public.book_copies(id) on delete cascade,
  claimant_id uuid not null references public.profiles(id)    on delete restrict,
  -- Who owned it when the claim was raised. Kept so an approved claim's record
  -- still reads correctly after the thing has moved on again.
  owner_id    uuid not null references public.profiles(id)    on delete restrict,
  kind        public.claim_kind   not null,
  status      public.claim_status not null default 'pending',
  note        text check (note is null or length(btrim(note)) <= 500),
  created_at  timestamptz not null default now(),
  -- Three days: long enough for an owner who checks in every other day, short
  -- enough that a forgotten claim does not sit on the item indefinitely.
  expires_at  timestamptz not null default now() + interval '3 days',
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);

-- One open claim per thing. Two people cannot both be "about to receive" it,
-- and the owner is never asked to adjudicate a race.
create unique index copy_claims_one_open on public.copy_claims (copy_id)
  where status = 'pending';
create index copy_claims_owner_idx on public.copy_claims (owner_id, created_at desc);
create index copy_claims_claimant_idx on public.copy_claims (claimant_id, created_at desc);

alter table public.copy_claims enable row level security;
grant select on public.copy_claims to authenticated;

-- Readable by the two people it is about, and by staff. No insert, update or
-- delete grant at all: every transition goes through a function below.
create policy copy_claims_select_involved on public.copy_claims
  for select to authenticated
  using (claimant_id = (select auth.uid())
         or owner_id = (select auth.uid())
         or private.is_staff());

-- Carried forward from 20260902000450 with the three claim events added; the
-- list is rewritten in full each time because a CHECK cannot be appended to.
alter table public.notifications
  drop constraint notifications_type_check,
  add  constraint notifications_type_check
    check (type in (
      'swap_requested','swap_accepted','swap_rejected','swap_cancelled',
      'swap_confirmed','swap_completed','wishlist_match','review_received',
      'comment_received','report_filed','report_resolved','moderation_action',
      'claim_requested','claim_approved','claim_rejected'));

-- ── The ledger learns a fourth way things move ───────────────────────────
-- A hand-to-hand handover is not a swap: there is no swap row to point at, and
-- oe_swap_transfer_has_swap rightly refuses a swap_transfer without one.
-- NOT VALID because an array column elsewhere uses this domain, which makes a
-- validating ALTER refuse; every existing row already satisfies it.

alter domain public.ownership_event_type drop constraint ownership_event_type_values;
alter domain public.ownership_event_type
  add constraint ownership_event_type_values
  check (value in ('initial_registration', 'swap_transfer', 'admin_correction',
                   'claim_transfer')) not valid;

-- Restores what 20260902000170 intended and a later migration overwrote: a
-- swap id belongs to a swap transfer, but a swap transfer whose swap was purged
-- keeps its row.
alter table public.ownership_events drop constraint oe_swap_transfer_has_swap;
alter table public.ownership_events
  add constraint oe_swap_transfer_has_swap
  check (swap_id is null or event_type = 'swap_transfer');

-- ── Looking a thing up by its code ────────────────────────────────────────
-- Anonymous too: a QR on a book is scanned by whoever is holding the book, and
-- everything returned here is already on the public listing page. What it adds
-- is the answer to "is this thing known to Solio at all?", which is the whole
-- question somebody with a scanner is asking.

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
         sp.name,
         exists (select 1 from public.copy_claims cc
                  where cc.copy_id = c.id and cc.status = 'pending'
                    and cc.expires_at > now())
    from public.book_copies c
    join public.books b    on b.id = c.book_id
    join public.profiles p on p.id = c.owner_id
    left join public.storage_points sp on sp.id = c.stored_at
   where c.public_code = public.normalize_item_code(p_code)
     and c.moderation_status = 'active'
     and p.account_status = 'active';
$$;
revoke all on function public.find_copy_by_code(text) from public;
grant execute on function public.find_copy_by_code(text) to anon, authenticated;

-- ── Raising a claim ───────────────────────────────────────────────────────

create or replace function public.claim_by_code(
  p_code text,
  p_kind text,
  p_note text default null)
returns table (claim_id uuid, copy_id uuid, owner_id uuid, kind text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_copy   public.book_copies%rowtype;
  v_recent int;
  v_claim  public.copy_claims%rowtype;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles
                  where id = v_actor and account_status = 'active') then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;
  if p_kind not in ('storage', 'ownership') then
    raise exception 'UNKNOWN_CLAIM_KIND' using errcode = '23514';
  end if;

  -- A storage claim says "it is on my shelf", which only means something if
  -- there is a shelf with an address on it.
  if p_kind = 'storage'
     and not exists (select 1 from public.storage_points sp where sp.profile_id = v_actor) then
    raise exception 'NOT_A_STORAGE_POINT' using errcode = '42501';
  end if;

  select count(*) into v_recent from public.copy_claims cc
   where cc.claimant_id = v_actor and cc.created_at > now() - interval '24 hours';
  if v_recent >= 60 then
    raise exception 'RATE_LIMIT_CLAIM' using errcode = '54000';
  end if;

  select * into v_copy from public.book_copies bc
   where bc.public_code = public.normalize_item_code(p_code) for update;
  if not found then
    raise exception 'ITEM_CODE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_copy.moderation_status <> 'active' then
    raise exception 'ITEM_NOT_AVAILABLE' using errcode = '42501';
  end if;
  if v_copy.owner_id = v_actor then
    raise exception 'ALREADY_YOURS' using errcode = '23514';
  end if;
  -- A reserved copy is promised to a live swap. Moving it — or even parking it
  -- at a café — behind that swap's back is how the ownership checks in
  -- complete_swap start failing.
  if v_copy.status = 'reserved' then
    raise exception 'ITEM_IN_ACTIVE_SWAP' using errcode = '23514';
  end if;

  -- Stale claims stop blocking the index the moment somebody asks again;
  -- a scheduled job for this would be a lot of machinery for one UPDATE.
  update public.copy_claims cc set status = 'expired', resolved_at = now()
   where cc.copy_id = v_copy.id and cc.status = 'pending' and cc.expires_at <= now();

  select * into v_claim from public.copy_claims cc
   where cc.copy_id = v_copy.id and cc.status = 'pending';
  if found then
    if v_claim.claimant_id = v_actor then
      -- Asking twice is not an error, it is impatience.
      return query select v_claim.id, v_claim.copy_id, v_claim.owner_id, v_claim.kind::text;
      return;
    end if;
    raise exception 'ITEM_ALREADY_CLAIMED' using errcode = '23505';
  end if;

  insert into public.copy_claims as cc (copy_id, claimant_id, owner_id, kind, note)
  values (v_copy.id, v_actor, v_copy.owner_id, p_kind, nullif(btrim(p_note), ''))
  returning * into v_claim;

  perform private.write_audit(v_actor, 'claim.requested', 'book_copy', v_copy.id::text,
                              'success', jsonb_build_object('kind', p_kind,
                                                            'claim', v_claim.id));
  -- Pointed at the copy, not the claim: the notification's job is to put the
  -- owner in front of the approve button, which lives on the item's page.
  perform private.emit_event('claim_requested', 'book_copy', v_copy.id,
                             array[v_copy.owner_id], v_actor,
                             jsonb_build_object('claim', v_claim.id, 'kind', p_kind));

  return query select v_claim.id, v_claim.copy_id, v_claim.owner_id, v_claim.kind::text;
end $$;

revoke all on function public.claim_by_code(text, text, text) from public, anon;
grant execute on function public.claim_by_code(text, text, text) to authenticated;

-- ── Answering one ─────────────────────────────────────────────────────────

create or replace function public.respond_to_claim(p_claim_id uuid, p_action text)
returns public.copy_claims
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_claim public.copy_claims%rowtype;
  v_copy  public.book_copies%rowtype;
  v_point uuid;
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
    update public.copy_claims set status = 'expired', resolved_at = now()
     where id = p_claim_id;
    raise exception 'CLAIM_EXPIRED' using errcode = '23514';
  end if;

  -- The claimant may withdraw; only the owner may approve or refuse.
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
    update public.copy_claims
       set status = case p_action when 'reject' then 'rejected' else 'cancelled' end,
           resolved_at = now(), resolved_by = v_actor
     where id = p_claim_id
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
  -- The owner may have changed their mind about the listing in the meantime,
  -- or the thing may have been pulled into a swap. Re-checked here, holding the
  -- row lock, because the claim was raised minutes or days ago.
  if v_copy.owner_id <> v_claim.owner_id then
    raise exception 'OWNERSHIP_CHANGED_SINCE_CLAIM' using errcode = '23514';
  end if;
  if v_copy.status = 'reserved' then
    raise exception 'ITEM_IN_ACTIVE_SWAP' using errcode = '23514';
  end if;

  if v_claim.kind = 'storage' then
    select id into v_point from public.storage_points where profile_id = v_claim.claimant_id;
    if v_point is null then
      raise exception 'NOT_A_STORAGE_POINT' using errcode = '42501';
    end if;
    -- Custody only. The owner still owns it; the venue is holding it.
    update public.book_copies
       set stored_at = v_point, stored_since = now()
     where id = v_copy.id;
  else
    -- Ownership. The same shape as the last phase of complete_swap: the copy
    -- moves, the ledger records why, and custody follows ownership because
    -- book_copies_custody_follows_ownership still says it must.
    update public.book_copies
       set owner_id = v_claim.claimant_id,
           custodian_id = v_claim.claimant_id,
           status = 'swapped',
           transfer_count = transfer_count + 1,
           -- It is in the new owner's hands now, wherever it was before.
           stored_at = null,
           stored_since = null
     where id = v_copy.id;

    insert into public.ownership_events
      (book_copy_id, from_owner_id, to_owner_id, event_type, actor_id, metadata)
    values (v_copy.id, v_claim.owner_id, v_claim.claimant_id, 'claim_transfer', v_actor,
            jsonb_build_object('source', 'claim', 'claim', p_claim_id));
  end if;

  update public.copy_claims
     set status = 'approved', resolved_at = now(), resolved_by = v_actor
   where id = p_claim_id
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

-- ── Reading them ──────────────────────────────────────────────────────────
-- The claim rows are readable by the two people involved, but the claimant's
-- name and the item's title are not on that table. One view, so neither the
-- owner's page nor the claimant's has to join them by hand.

create or replace function public.list_my_claims()
returns table (
  claim_id      uuid,
  copy_id       uuid,
  public_code   text,
  title         text,
  author        text,
  item_kind     text,
  cover_key     text,
  kind          text,
  status        text,
  note          text,
  created_at    timestamptz,
  expires_at    timestamptz,
  role          text,
  other_id      uuid,
  other_name    text,
  other_user    text,
  other_point   text)
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
         other.id, other.display_name, other.username, sp.name
    from public.copy_claims cc
    join public.book_copies c on c.id = cc.copy_id
    join public.books b       on b.id = c.book_id
    join public.profiles other
      on other.id = case when cc.owner_id = (select auth.uid())
                         then cc.claimant_id else cc.owner_id end
    left join public.storage_points sp on sp.profile_id = cc.claimant_id
   where (select auth.uid()) in (cc.owner_id, cc.claimant_id)
   order by cc.created_at desc
   limit 100;
$$;
revoke all on function public.list_my_claims() from public, anon;
grant execute on function public.list_my_claims() to authenticated;
