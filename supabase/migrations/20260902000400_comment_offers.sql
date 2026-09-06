-- Answering a request with a book, not just with words.
--
-- A request post says "I am looking for this". The useful reply is usually "I
-- have it — is this the one?", and until now that had to be typed out with the
-- title copied by hand and no way to click through. A comment on a request may
-- now carry one of the commenter's own listings.
--
-- It hangs off comments rather than getting a table of its own: an offer *is* a
-- reply, it belongs in the same thread, and it inherits the moderation and rate
-- limiting that are already there.

alter table public.comments
  add column offered_copy_id uuid references public.book_copies(id) on delete set null;

create index comments_offered_idx on public.comments (offered_copy_id)
  where offered_copy_id is not null;

create or replace function private.comments_insert_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare v_parent record; v_owner uuid;
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

  if new.offered_copy_id is not null then
    -- Offering makes sense as an answer to a request, not on a listing's own
    -- thread, where the listing is already the subject.
    if new.request_id is null then
      raise exception 'OFFERS_BELONG_ON_REQUESTS' using errcode = '23514';
    end if;
    select owner_id into v_owner from public.book_copies where id = new.offered_copy_id;
    if v_owner is null then
      raise exception 'OFFERED_LISTING_NOT_FOUND' using errcode = 'P0002';
    end if;
    -- You can only offer your own book. Checked here rather than trusted from
    -- the client, which is the only place it can be checked reliably.
    if v_owner is distinct from new.user_id then
      raise exception 'NOT_YOUR_LISTING' using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

create or replace function private.comments_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;   -- withdrawing your own words carries no history obligation
  end if;

  if not private.is_privileged_context() then
    if new.user_id      is distinct from old.user_id
       or new.book_copy_id    is distinct from old.book_copy_id
       or new.request_id      is distinct from old.request_id
       or new.parent_id       is distinct from old.parent_id
       or new.offered_copy_id is distinct from old.offered_copy_id
       or new.created_at      is distinct from old.created_at then
      raise exception 'COMMENT_IMMUTABLE_FIELD' using errcode = '42501';
    end if;
    if new.moderation_status is distinct from old.moderation_status then
      raise exception 'MODERATION_IS_STAFF_ONLY' using errcode = '42501';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;
