-- The admin panel's delete button refused almost everything.
--
-- purge_content counts the live swaps touching a book — every copy of it, from
-- every owner — and raises LISTING_IN_ACTIVE_SWAP if there are any. On a site
-- where swapping is the point, that means the delete button works only on the
-- books nobody wants. A moderator reaching for it is not asking whether a swap
-- is in progress; they are looking at something that has to go now.
--
-- So the swap stops being an obstacle and becomes part of the job: cancel it,
-- tell both participants, put the other person's book back on the shelf, then
-- delete. The refusal stays where it belongs — on delete_listing, which is the
-- *owner's* door, and where "finish your swap first" is the right answer.

create or replace function private.clear_swaps_for_copies(p_copy_ids uuid[], p_actor uuid)
returns int
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_swap uuid;
  v_swaps uuid[];
  v_count int := 0;
begin
  select coalesce(array_agg(distinct s.id), '{}') into v_swaps
    from public.swap_items i
    join public.swaps s on s.id = i.swap_id
   where i.book_copy_id = any(p_copy_ids)
     and s.status in ('REQUESTED', 'ACCEPTED', 'CONFIRMED');

  foreach v_swap in array v_swaps loop
    update public.swaps
       set status = 'CANCELLED', closed_at = now()
     where id = v_swap;

    -- Whatever the swap had locked goes back on the shelf — except the copies
    -- that are about to be deleted, which have no shelf to go back to.
    update public.book_copies bc
       set status = 'available'
     where bc.status = 'reserved'
       and bc.id in (select book_copy_id from public.swap_items where swap_id = v_swap)
       and not (bc.id = any(p_copy_ids));

    perform private.emit_event('swap_cancelled', 'swap', v_swap,
                               array[(select requester_id from public.swaps where id = v_swap),
                                     (select responder_id from public.swaps where id = v_swap)],
                               p_actor,
                               jsonb_build_object('reason', 'moderation'));
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

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
  v_book uuid;
  v_copies uuid[] := '{}';
  v_swaps int := 0;
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

      v_copies := array[p_entity_id];
      v_swaps := private.clear_swaps_for_copies(v_copies, v_actor);

      select coalesce(array_agg(i.storage_key), '{}') into v_keys
        from public.book_images i where i.book_copy_id = p_entity_id;

      -- ownership_events RESTRICTs the copy, so it goes first; images, comments,
      -- claims, swap items and the shelf pointer all cascade.
      delete from public.ownership_events where book_copy_id = p_entity_id;
      delete from public.book_copies where id = p_entity_id;

      -- The catalogue row is shared, so it only goes when the last copy does.
      delete from public.books b
       where b.id = v_book
         and not exists (select 1 from public.book_copies c where c.book_id = b.id);

    when 'book' then
      select b.title into v_label from public.books b where b.id = p_entity_id;
      if v_label is null then
        raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
      end if;

      select coalesce(array_agg(c.id), '{}') into v_copies
        from public.book_copies c where c.book_id = p_entity_id;
      v_swaps := private.clear_swaps_for_copies(v_copies, v_actor);

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
      delete from public.comments where id = p_entity_id;

    when 'request' then
      select title into v_label from public.book_requests where id = p_entity_id;
      if v_label is null then
        raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
      end if;
      delete from public.book_requests where id = p_entity_id;
  end case;

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
                                                 'swaps_cancelled', v_swaps,
                                                 'images', coalesce(array_length(v_keys, 1), 0)));

  return query select unnest(v_keys);
end $$;

revoke all on function public.purge_content(text, uuid, text) from public, anon;
grant execute on function public.purge_content(text, uuid, text) to authenticated;

-- admin_delete_listing was doing the same work inline; it now shares the helper
-- so the two doors cannot drift apart.
create or replace function public.admin_delete_listing(p_copy_id uuid, p_reason text default null)
returns table (storage_key text)
language plpgsql volatile security definer set search_path = ''
as $$
begin
  return query select * from public.purge_content('book_copy', p_copy_id, p_reason);
end $$;

revoke all on function public.admin_delete_listing(uuid, text) from public, anon;
grant execute on function public.admin_delete_listing(uuid, text) to authenticated;
