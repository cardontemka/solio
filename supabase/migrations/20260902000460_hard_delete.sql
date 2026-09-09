-- Deleting content should delete it.
--
-- Until now a moderator's "Устгах" set moderation_status = 'removed', which is
-- what "Нуух" already did with a different word on the button. Two names for one
-- reversible action, and the row — with its title, its description, its photos
-- still sitting in the bucket — stayed exactly where it was. Nobody reading the
-- admin screen could tell what the second button was for.
--
-- So hiding stays reversible and delete becomes real: the rows go, and the
-- function hands back the storage keys it orphaned so the caller can remove the
-- objects from the bucket in the same breath. What remains is the audit row,
-- which stores ids as text and therefore survives the thing it describes — the
-- record that something was deleted, by whom and why, is the one part that must
-- outlive it.
--
-- Admin, not staff. Hiding is a judgement a moderator can make and undo;
-- this one cannot be undone by anybody.

create or replace function private.require_admin(p_action text, p_entity text, p_id text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not private.has_role('admin') then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  return v_actor;
end $$;

/*
 * Really removes a piece of content, and returns the storage keys that are now
 * unreferenced so the caller can delete the objects too.
 *
 * SECURITY DEFINER, owned by the superuser, which is what lets it past the
 * table guards: they all refuse DELETE unless private.history_override() holds,
 * and it holds for exactly this — a function running as postgres — and for a
 * psql session. The Data API cannot reach a DELETE any other way.
 *
 * A listing inside a live swap is refused. That swap is a promise to somebody
 * else, and deleting one side of it mid-flight leaves the other person holding
 * a request against nothing. Finish or cancel it first. A swap that has already
 * completed does not block the delete: its swap_items row goes with the copy,
 * and the ownership_events for the copy go too, so the swap keeps its record
 * with one fewer title in it. That is the honest cost of a real delete and the
 * audit row is where the trace lives instead.
 */
create or replace function public.purge_content(
  p_entity_type text,
  p_entity_id   uuid,
  p_reason      text default null)
returns table (storage_key text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := private.require_admin('purge.' || p_entity_type, p_entity_type,
                                        p_entity_id::text);
  v_keys text[] := '{}';
  v_label text;
  v_live int;
  v_book uuid;
begin
  if p_entity_type not in ('book_copy', 'book', 'comment', 'request') then
    raise exception 'UNSUPPORTED_ENTITY_TYPE' using errcode = '23514';
  end if;

  case p_entity_type
    when 'book_copy' then
      select b.title, c.book_id into v_label, v_book
        from public.book_copies c join public.books b on b.id = c.book_id
       where c.id = p_entity_id;
      if v_label is null then
        raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
      end if;

      select count(*) into v_live
        from public.swap_items i join public.swaps s on s.id = i.swap_id
       where i.book_copy_id = p_entity_id
         and s.status in ('REQUESTED', 'ACCEPTED', 'CONFIRMED');
      if v_live > 0 then
        raise exception 'LISTING_IN_ACTIVE_SWAP' using errcode = '42501';
      end if;

      select coalesce(array_agg(i.storage_key), '{}') into v_keys
        from public.book_images i where i.book_copy_id = p_entity_id;

      -- ownership_events RESTRICTs the copy, so it goes first; images, comments
      -- and swap_items all cascade.
      delete from public.ownership_events where book_copy_id = p_entity_id;
      delete from public.book_copies where id = p_entity_id;

      -- The catalogue row exists to back listings. Other people may share it,
      -- so it only goes when the last copy of it does.
      delete from public.books b
       where b.id = v_book
         and not exists (select 1 from public.book_copies c where c.book_id = b.id);

    when 'book' then
      select b.title into v_label from public.books b where b.id = p_entity_id;
      if v_label is null then
        raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
      end if;

      select count(*) into v_live
        from public.swap_items i
        join public.swaps s on s.id = i.swap_id
        join public.book_copies c on c.id = i.book_copy_id
       where c.book_id = p_entity_id
         and s.status in ('REQUESTED', 'ACCEPTED', 'CONFIRMED');
      if v_live > 0 then
        raise exception 'LISTING_IN_ACTIVE_SWAP' using errcode = '42501';
      end if;

      select coalesce(array_agg(i.storage_key), '{}') into v_keys
        from public.book_images i
        join public.book_copies c on c.id = i.book_copy_id
       where c.book_id = p_entity_id;

      delete from public.ownership_events
       where book_copy_id in (select id from public.book_copies where book_id = p_entity_id);
      delete from public.book_copies where book_id = p_entity_id;
      delete from public.books where id = p_entity_id;

    when 'comment' then
      select left(body, 80) into v_label from public.comments where id = p_entity_id;
      if v_label is null then
        raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
      end if;
      -- Replies cascade through comments.parent_id.
      delete from public.comments where id = p_entity_id;

    when 'request' then
      select title into v_label from public.book_requests where id = p_entity_id;
      if v_label is null then
        raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
      end if;
      delete from public.book_requests where id = p_entity_id;
  end case;

  -- Reports pointing at something that no longer exists have nothing left to
  -- judge. Closing them here keeps the queue honest rather than leaving rows
  -- whose target link 404s.
  update public.reports
     set status = 'resolved',
         resolved_by = v_actor,
         resolved_at = now(),
         resolution_note = coalesce(resolution_note, 'Контентыг устгасан')
   where entity_type = p_entity_type
     and entity_id = p_entity_id
     and status in ('open', 'reviewing');

  perform private.write_audit(v_actor, 'purge.' || p_entity_type, p_entity_type,
                              p_entity_id::text, 'success',
                              jsonb_build_object('label', v_label,
                                                 'reason', p_reason,
                                                 'images', coalesce(array_length(v_keys, 1), 0)));

  return query select unnest(v_keys);
end $$;

revoke all on function public.purge_content(text, uuid, text) from public, anon;
grant execute on function public.purge_content(text, uuid, text) to authenticated;

-- ── The owner's own delete leaks its photos ───────────────────────────────
-- delete_listing removes the book_images rows by cascade but never told anybody
-- which objects those rows pointed at, so every deleted listing left its photos
-- in the bucket for good. It returns them now, and the action deletes them.

-- The return type changes from void, which CREATE OR REPLACE cannot do.
drop function if exists public.delete_listing(uuid);

create function public.delete_listing(p_copy_id uuid)
returns table (storage_key text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_book  uuid;
  v_live  int;
  v_keys  text[] := '{}';
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select owner_id, book_id into v_owner, v_book
    from public.book_copies where id = p_copy_id;
  if v_owner is null then
    raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_owner <> v_actor then
    raise exception 'NOT_YOUR_LISTING' using errcode = '42501';
  end if;

  -- A swap in flight is a promise to another person; the listing cannot be
  -- pulled out from under it. Cancel or finish the swap first.
  select count(*) into v_live
    from public.swap_items i
    join public.swaps s on s.id = i.swap_id
   where i.book_copy_id = p_copy_id
     and s.status in ('REQUESTED','ACCEPTED','CONFIRMED');
  if v_live > 0 then
    raise exception 'LISTING_IN_ACTIVE_SWAP' using errcode = '42501';
  end if;

  select coalesce(array_agg(i.storage_key), '{}') into v_keys
    from public.book_images i where i.book_copy_id = p_copy_id;

  perform private.write_audit(v_actor, 'listing.deleted', 'book_copy',
                              p_copy_id::text, 'success',
                              jsonb_build_object('book_id', v_book,
                                                 'images', coalesce(array_length(v_keys, 1), 0)));

  delete from public.ownership_events where book_copy_id = p_copy_id;
  -- Photos, comments and swap items all cascade from here.
  delete from public.book_copies where id = p_copy_id;

  -- Leave no orphan in search: a catalogue row exists to back listings, and
  -- other people may still hold copies of this one.
  delete from public.books b
   where b.id = v_book
     and not exists (select 1 from public.book_copies c where c.book_id = b.id);

  return query select unnest(v_keys);
end $$;

revoke all on function public.delete_listing(uuid) from public, anon;
grant execute on function public.delete_listing(uuid) to authenticated;
