-- Two additions.
--
-- ── Web push ──────────────────────────────────────────────────────────────
-- Browsers deliver notifications through a push service the site does not
-- control, addressed by an endpoint URL plus two keys the browser generates.
-- Those are per-browser, not per-account, so one person can have several.
--
-- Which notifications still need pushing is answered by the notifications table
-- itself rather than by every RPC reporting its recipients: emit_event already
-- knows who to tell, so a `pushed_at` stamp turns that into a queue with one
-- place to drain it.
--
-- ── Public swap history ───────────────────────────────────────────────────
-- swaps stays participant-only; a function exposes just the finished ones, with
-- the titles that changed hands. All of it is already public — both listings
-- are, and the ownership transfer is visible on the copies — but the join is
-- not something an anonymous reader can make for themselves.

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  -- The push service's address for this browser. Unique because re-subscribing
  -- in the same browser returns the same endpoint, and two rows would mean two
  -- copies of every notification.
  endpoint     text not null unique check (length(endpoint) between 8 and 1000),
  p256dh       text not null check (length(p256dh) between 8 and 400),
  auth         text not null check (length(auth)   between 8 and 200),
  user_agent   text check (user_agent is null or length(user_agent) <= 400),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force  row level security;

-- A subscription is a private address for one person's browser: only they may
-- see or change it. Sending runs as service_role, which bypasses RLS.
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid())
                                          and private.is_active_account());
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, delete on public.push_subscriptions to authenticated;

-- ── The push queue ────────────────────────────────────────────────────────
alter table public.notifications
  add column if not exists pushed_at timestamptz;

-- Partial: the queue is the unpushed tail, which stays small even as the table
-- grows.
create index if not exists notifications_push_queue_idx
  on public.notifications (created_at) where pushed_at is null;

-- notifications_guard refuses every column but read_at to a non-privileged
-- caller. pushed_at is written by the sender, which runs as service_role — not
-- a privileged context — so the guard has to know about it.
create or replace function private.notifications_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.history_override() then return old; end if;
    raise exception 'NOTIFICATIONS_ARE_NOT_DELETED' using errcode = '42501';
  end if;
  if not private.is_privileged_context() then
    if new.user_id     is distinct from old.user_id
       or new.type        is distinct from old.type
       or new.entity_type is distinct from old.entity_type
       or new.entity_id   is distinct from old.entity_id
       or new.payload     is distinct from old.payload
       or new.created_at  is distinct from old.created_at then
      raise exception 'ONLY_READ_STATE_IS_EDITABLE' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- authenticated must not be able to mark its own notifications as pushed, or
-- it could silence them; the column grant is service_role's alone.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ── Public swap history ───────────────────────────────────────────────────
create or replace function public.get_swap_history(p_user uuid)
returns table (
  swap_id            uuid,
  completed_at       timestamptz,
  counterparty_name  text,
  counterparty_user  text,
  gave_titles        text[],
  received_titles    text[])
language sql stable security definer set search_path = ''
as $$
  select
    s.id,
    s.completed_at,
    p.display_name,
    p.username,
    -- "Gave" is the side this person put on the table, whichever role they had.
    array_remove(array_agg(distinct case when i.side =
        (case when s.requester_id = p_user then 'offered' else 'requested' end)
      then b.title end), null),
    array_remove(array_agg(distinct case when i.side =
        (case when s.requester_id = p_user then 'requested' else 'offered' end)
      then b.title end), null)
  from public.swaps s
  join public.profiles p
    on p.id = case when s.requester_id = p_user then s.responder_id else s.requester_id end
  join public.swap_items i on i.swap_id = s.id
  join public.book_copies c on c.id = i.book_copy_id
  join public.books b on b.id = c.book_id
  where s.status = 'COMPLETED'
    and p_user in (s.requester_id, s.responder_id)
  group by s.id, s.completed_at, p.display_name, p.username
  order by s.completed_at desc
  limit 50
$$;

revoke all     on function public.get_swap_history(uuid) from public;
grant  execute on function public.get_swap_history(uuid) to anon, authenticated;
