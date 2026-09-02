-- The immutable ownership ledger. book_copies.owner_id is the current-state
-- projection; this table is the history. They are written in one statement so
-- they cannot diverge.

create table public.ownership_events (
  id            bigint generated always as identity primary key,
  book_copy_id  uuid not null references public.book_copies(id) on delete restrict,
  from_owner_id uuid          references public.profiles(id)    on delete restrict,
  to_owner_id   uuid not null references public.profiles(id)    on delete restrict,
  event_type    public.ownership_event_type not null,
  swap_id       uuid,
  actor_id      uuid references public.profiles(id) on delete restrict,
  metadata      jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now(),

  constraint oe_no_self_transfer
    check (from_owner_id is distinct from to_owner_id),
  constraint oe_initial_has_no_source
    check ((event_type = 'initial_registration') = (from_owner_id is null))
);

create index ownership_events_copy_idx on public.ownership_events (book_copy_id, id);

-- Physically prevents a copy being transferred twice by the same swap, so a
-- retried or replayed completion raises 23505 instead of duplicating history.
create unique index ownership_events_one_per_swap_copy
  on public.ownership_events (swap_id, book_copy_id) where swap_id is not null;

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_role  public.app_role,
  action      text not null check (length(action) between 3 and 64),
  entity_type text not null,
  entity_id   text not null,
  outcome     text not null default 'success' check (outcome in ('success','denied')),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id, created_at desc);

-- ── Immutability ──────────────────────────────────────────────────────────
-- Triggers, not just RLS: postgres and service_role carry BYPASSRLS, so RLS
-- alone would not stop them. Triggers fire for every role.

create or replace function private.solio_deny_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'TABLE_IS_APPEND_ONLY: %', tg_table_name using errcode = '42501';
end $$;

create trigger ownership_events_immutable_trg
  before update or delete on public.ownership_events
  for each row execute function private.solio_deny_mutation();
create trigger ownership_events_no_truncate_trg
  before truncate on public.ownership_events
  for each statement execute function private.solio_deny_mutation();

create trigger audit_logs_immutable_trg
  before update or delete on public.audit_logs
  for each row execute function private.solio_deny_mutation();
create trigger audit_logs_no_truncate_trg
  before truncate on public.audit_logs
  for each statement execute function private.solio_deny_mutation();

-- ── Event emitter (the seam) ──────────────────────────────────────────────
-- Audit log  = who performed which system action (incl. denials).
-- Domain event = which business fact occurred (drives notifications).
-- Both are written inside the caller's transaction. When email/push arrive,
-- an outbox insert is added HERE and nowhere else.

create or replace function private.write_audit(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id text,
  p_outcome text default 'success', p_payload jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into public.audit_logs (actor_id, actor_role, action, entity_type,
                                 entity_id, outcome, payload)
  values (p_actor,
          (select r.role from public.user_roles r where r.user_id = p_actor
            order by case r.role when 'admin' then 1 when 'moderator' then 2 else 3 end
            limit 1),
          p_action, p_entity_type, p_entity_id, p_outcome, p_payload);
$$;
