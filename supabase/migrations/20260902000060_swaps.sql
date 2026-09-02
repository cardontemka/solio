-- Swaps: the transaction aggregate, its items, and the state machine guard.
--
-- The DB supports N offered ↔ N requested items; the MVP RPC signature is 1↔1.
-- Going N↔N later is a new function taking uuid[], with no schema change.

create domain public.swap_status as text
  constraint swap_status_values
  check (value in ('REQUESTED','ACCEPTED','CONFIRMED','COMPLETED','REJECTED','CANCELLED'));

create table public.swaps (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete restrict,
  responder_id uuid not null references public.profiles(id) on delete restrict,
  status       public.swap_status not null default 'REQUESTED',
  -- Set by the FIRST party to confirm handover. The second party (who must be
  -- a different person) is the only one who can then complete the swap.
  confirmed_by uuid references public.profiles(id) on delete restrict,
  message      text check (message is null or length(message) <= 2000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  closed_at    timestamptz,

  constraint swaps_distinct_parties check (requester_id <> responder_id),
  constraint swaps_confirmed_by_is_party
    check (confirmed_by is null or confirmed_by in (requester_id, responder_id)),
  constraint swaps_completed_stamp
    check ((status = 'COMPLETED') = (completed_at is not null)),
  constraint swaps_closed_stamp
    check ((status in ('COMPLETED','REJECTED','CANCELLED')) = (closed_at is not null))
);

create index swaps_requester_idx on public.swaps (requester_id, status, created_at desc);
create index swaps_responder_idx on public.swaps (responder_id, status, created_at desc);

create table public.swap_items (
  swap_id      uuid not null references public.swaps(id)       on delete restrict,
  book_copy_id uuid not null references public.book_copies(id) on delete restrict,
  side         text not null check (side in ('offered','requested')),
  primary key (swap_id, book_copy_id)
);
create index swap_items_copy_idx on public.swap_items (book_copy_id);

-- ownership_events.swap_id was created before this table existed.
alter table public.ownership_events
  add constraint ownership_events_swap_id_fkey
  foreign key (swap_id) references public.swaps(id) on delete restrict;
alter table public.ownership_events
  add constraint oe_swap_transfer_has_swap
  check ((event_type = 'swap_transfer') = (swap_id is not null));

-- ── In-app notifications ──────────────────────────────────────────────────
create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in (
                'swap_requested','swap_accepted','swap_rejected','swap_cancelled',
                'swap_confirmed','swap_completed','wishlist_match',
                'review_received','report_resolved','moderation_action')),
  entity_type text not null check (entity_type in
                ('swap','book','book_copy','review','report','profile')),
  entity_id   uuid not null,
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx
  on public.notifications (user_id, created_at desc) where read_at is null;

-- ── The state machine ─────────────────────────────────────────────────────
-- Six legal edges out of thirty ordered pairs. COMPLETED / REJECTED /
-- CANCELLED are terminal: no edge leaves them.

create or replace function private.is_valid_swap_edge(p_from text, p_to text)
returns boolean language sql immutable set search_path = ''
as $$
  select (p_from, p_to) in (
    ('REQUESTED','ACCEPTED'), ('REQUESTED','REJECTED'), ('REQUESTED','CANCELLED'),
    ('ACCEPTED','CONFIRMED'), ('ACCEPTED','CANCELLED'), ('CONFIRMED','COMPLETED'));
$$;

-- Final authority for swap state. Runs for EVERY role including service_role,
-- which carries BYPASSRLS — so a leaked service key still cannot rewrite a
-- completed transaction.
create or replace function private.swaps_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'SWAPS_ARE_NEVER_DELETED' using errcode = '42501';
  end if;
  if not private.is_privileged_context() then
    raise exception 'DIRECT_SWAP_WRITE_FORBIDDEN' using errcode = '42501',
      hint = 'Swaps change only through request_swap/respond_to_swap/complete_swap.';
  end if;
  if old.status in ('COMPLETED','REJECTED','CANCELLED') then
    raise exception 'SWAP_IS_TERMINAL_%', old.status using errcode = '42501';
  end if;
  if new.requester_id is distinct from old.requester_id
     or new.responder_id is distinct from old.responder_id
     or new.created_at  is distinct from old.created_at then
    raise exception 'SWAP_IMMUTABLE_FIELD' using errcode = '23514';
  end if;
  if new.status is distinct from old.status
     and not private.is_valid_swap_edge(old.status, new.status) then
    raise exception 'INVALID_TRANSITION_%_TO_%', old.status, new.status
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger swaps_guard_trg before update or delete on public.swaps
  for each row execute function private.swaps_guard();

create or replace function private.is_swap_participant(p_swap uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.swaps
                      where id = p_swap
                        and (select auth.uid()) in (requester_id, responder_id)) $$;

-- ── Event emitter (the seam) ──────────────────────────────────────────────
-- Domain event → notification. Written in the caller's transaction, so a
-- rolled-back swap leaves no phantom notification. When email/push arrive, an
-- outbox insert is added HERE and nowhere else.
create or replace function private.emit_event(
  p_type        text,
  p_entity_type text,
  p_entity_id   uuid,
  p_recipients  uuid[],
  p_actor       uuid default null,
  p_payload     jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into public.notifications (user_id, type, entity_type, entity_id, payload)
  select u, p_type, p_entity_type, p_entity_id, p_payload
    from unnest(p_recipients) u
   where u is not null
     and u is distinct from p_actor;   -- never notify the actor about their own action
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.swaps         enable row level security;
alter table public.swap_items    enable row level security;
alter table public.notifications enable row level security;

-- SELECT only. No INSERT/UPDATE/DELETE grant exists on swaps or swap_items,
-- so the PostgREST write path does not exist at all.
grant select         on public.swaps         to authenticated;
grant select         on public.swap_items    to authenticated;
grant select, update on public.notifications to authenticated;

create policy swaps_select_participant on public.swaps
  for select to authenticated
  using ((select auth.uid()) in (requester_id, responder_id) or private.is_staff());

create policy swap_items_select_participant on public.swap_items
  for select to authenticated
  using (private.is_swap_participant(swap_id) or private.is_staff());

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
