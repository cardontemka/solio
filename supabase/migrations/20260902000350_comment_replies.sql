-- Two things a comment thread needs to be a thread.
--
-- 1. Replies. A flat list makes people quote each other by hand; one level of
--    nesting is enough to answer somebody without reproducing their words.
--    Only one level: deeper trees are a different design problem and this MVP
--    does not have it yet, so a reply to a reply attaches to the same parent.
--
-- 2. A way to point at the comment being announced. The notification carried
--    only the listing or request id, so "somebody replied" landed at the top of
--    a page and left the reader to find what changed. The comment id now rides
--    in the payload, and the link can anchor to it.

alter table public.comments
  add column parent_id uuid references public.comments(id) on delete cascade;

create index comments_parent_idx on public.comments (parent_id, created_at)
  where parent_id is not null;

-- A reply belongs to the same thread as what it answers. Without this, a reply
-- could be attached to a comment on an entirely different listing and would
-- render under both.
create or replace function private.comments_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare v_parent record;
begin
  if tg_op = 'DELETE' then
    return old;   -- withdrawing your own words carries no history obligation
  end if;

  if not private.is_privileged_context() then
    if new.user_id      is distinct from old.user_id
       or new.book_copy_id is distinct from old.book_copy_id
       or new.request_id   is distinct from old.request_id
       or new.parent_id    is distinct from old.parent_id
       or new.created_at   is distinct from old.created_at then
      raise exception 'COMMENT_IMMUTABLE_FIELD' using errcode = '42501';
    end if;
    if new.moderation_status is distinct from old.moderation_status then
      raise exception 'MODERATION_IS_STAFF_ONLY' using errcode = '42501';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create or replace function private.comments_insert_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare v_parent record;
begin
  if new.parent_id is not null then
    select book_copy_id, request_id, parent_id into v_parent
      from public.comments where id = new.parent_id;
    if not found then
      raise exception 'PARENT_COMMENT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_parent.parent_id is not null then
      raise exception 'REPLIES_ARE_ONE_LEVEL' using errcode = '23514',
        hint = 'Reply to the top-level comment instead.';
    end if;
    if new.book_copy_id is distinct from v_parent.book_copy_id
       or new.request_id is distinct from v_parent.request_id then
      raise exception 'REPLY_MUST_MATCH_PARENT_THREAD' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger comments_insert_guard_trg
  before insert on public.comments
  for each row execute function private.comments_insert_guard();

-- ── Point the notification at the comment ─────────────────────────────────
create or replace function public.notify_comment(p_comment_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_copy_id    uuid;
  v_request_id uuid;
  v_parent_id  uuid;
  v_recipient  uuid;
  v_payload    jsonb;
begin
  select book_copy_id, request_id, parent_id
    into v_copy_id, v_request_id, v_parent_id
    from public.comments where id = p_comment_id;

  v_payload := jsonb_build_object('comment_id', p_comment_id);

  -- A reply answers a person; a new comment answers whoever owns the thing.
  if v_parent_id is not null then
    select user_id into v_recipient from public.comments where id = v_parent_id;
  elsif v_copy_id is not null then
    select owner_id into v_recipient from public.book_copies where id = v_copy_id;
  elsif v_request_id is not null then
    select user_id into v_recipient from public.book_requests where id = v_request_id;
  end if;

  if v_recipient is null or v_recipient is not distinct from p_actor then
    return;
  end if;

  if v_copy_id is not null then
    perform private.emit_event('comment_received', 'book_copy', v_copy_id,
                               array[v_recipient], p_actor, v_payload);
  else
    perform private.emit_event('comment_received', 'request', v_request_id,
                               array[v_recipient], p_actor, v_payload);
  end if;
end $$;

revoke all     on function public.notify_comment(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.notify_comment(uuid, uuid) to service_role;
