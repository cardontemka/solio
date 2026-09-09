-- A second, small copy of every photo, so grids stop shipping full-size images.
--
-- The measurement that prompted this: a book card renders its cover about 180px
-- wide, and was being handed the 1600px upload — 250KB for 180px of screen. The
-- optimizer papered over it by generating a small variant on the fly, which is
-- exactly the thing that is metered on the hosting plan and the first limit this
-- site would have hit.
--
-- So the small copy is made once, in the browser, at the moment of upload, and
-- stored beside the original. Grids read the thumbnail, the book page reads the
-- original, and neither goes through an optimizer: the bucket's egress is free
-- and both files are already the right size and format.
--
-- The key is the original's, with `-t` before the extension. Derivable in both
-- directions, which means no extra round trip to find one from the other, and
-- the CHECK still pins the shape so a forged key cannot point anywhere else.
--
-- Nullable on purpose: every photo uploaded before today has no thumbnail, and
-- the readers fall back to the original rather than showing a hole.

alter table public.book_images
  add column thumb_key text
  constraint book_images_thumb_key_check
  check (thumb_key is null
         or thumb_key ~ '^copies/[0-9a-f-]{36}/[0-9a-f-]{36}-t\.jpg$');

create unique index book_images_thumb_key_key
  on public.book_images (thumb_key) where thumb_key is not null;

-- The guard treats every other storage field as server-owned; the thumbnail is
-- one too. publish_image is the only way it gets set.
create or replace function private.book_images_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.history_override() then return old; end if;
    raise exception 'IMAGES_ARE_NOT_HARD_DELETED' using errcode = '42501',
      hint = 'Set status = ''removed'' instead.';
  end if;
  if not private.is_privileged_context() then
    if new.storage_key is distinct from old.storage_key
       or new.thumb_key   is distinct from old.thumb_key
       or new.mime_type   is distinct from old.mime_type
       or new.byte_size   is distinct from old.byte_size
       or new.width       is distinct from old.width
       or new.height      is distinct from old.height
       or new.book_copy_id is distinct from old.book_copy_id
       or new.uploaded_by is distinct from old.uploaded_by
       or new.provider    is distinct from old.provider then
      raise exception 'IMAGE_METADATA_IS_SERVER_OWNED' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status <> 'removed' then
      raise exception 'ONLY_SERVER_MAY_PUBLISH_IMAGE' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- publish_image records the thumbnail if one was uploaded. It is checked against
-- the row's own storage_key rather than trusted: the only key this image may
-- carry is its own, with the suffix.
create or replace function public.publish_image(
  p_image_id  uuid,
  p_width     int,
  p_height    int,
  p_byte_size int,
  p_thumb_key text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key   text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select i.storage_key into v_key
    from public.book_images i
    join public.book_copies c on c.id = i.book_copy_id
   where i.id = p_image_id and c.owner_id = v_actor and i.status = 'pending';
  if v_key is null then
    raise exception 'NOT_YOUR_PENDING_IMAGE' using errcode = '42501';
  end if;

  if p_thumb_key is not null
     and p_thumb_key <> regexp_replace(v_key, '\.(jpg|png|webp)$', '-t.jpg') then
    raise exception 'THUMB_KEY_MISMATCH' using errcode = '42501';
  end if;

  update public.book_images
     set status = 'ready',
         width = p_width,
         height = p_height,
         byte_size = p_byte_size,
         thumb_key = p_thumb_key
   where id = p_image_id;
end $$;

drop function if exists public.publish_image(uuid,int,int,int);
revoke all on function public.publish_image(uuid,int,int,int,text) from public, anon;
grant execute on function public.publish_image(uuid,int,int,int,text) to authenticated;

-- ── Deleting takes both files ─────────────────────────────────────────────
-- Both purge paths gathered storage_key only, so from today every deleted photo
-- would have left its thumbnail in the bucket. Collecting both keeps the rule
-- the last migration established: when a row goes, its bytes go.

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

      select coalesce(array_agg(k), '{}') into v_keys from (
        select i.storage_key as k from public.book_images i where i.book_copy_id = p_entity_id
        union all
        select i.thumb_key from public.book_images i
         where i.book_copy_id = p_entity_id and i.thumb_key is not null) x;

      delete from public.ownership_events where book_copy_id = p_entity_id;
      delete from public.book_copies where id = p_entity_id;

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

      select coalesce(array_agg(k), '{}') into v_keys from (
        select i.storage_key as k
          from public.book_images i join public.book_copies c on c.id = i.book_copy_id
         where c.book_id = p_entity_id
        union all
        select i.thumb_key
          from public.book_images i join public.book_copies c on c.id = i.book_copy_id
         where c.book_id = p_entity_id and i.thumb_key is not null) x;

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
                                                 'files', coalesce(array_length(v_keys, 1), 0)));

  return query select unnest(v_keys);
end $$;

revoke all on function public.purge_content(text, uuid, text) from public, anon;
grant execute on function public.purge_content(text, uuid, text) to authenticated;

create or replace function public.delete_listing(p_copy_id uuid)
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

  select count(*) into v_live
    from public.swap_items i
    join public.swaps s on s.id = i.swap_id
   where i.book_copy_id = p_copy_id
     and s.status in ('REQUESTED','ACCEPTED','CONFIRMED');
  if v_live > 0 then
    raise exception 'LISTING_IN_ACTIVE_SWAP' using errcode = '42501';
  end if;

  select coalesce(array_agg(k), '{}') into v_keys from (
    select i.storage_key as k from public.book_images i where i.book_copy_id = p_copy_id
    union all
    select i.thumb_key from public.book_images i
     where i.book_copy_id = p_copy_id and i.thumb_key is not null) x;

  perform private.write_audit(v_actor, 'listing.deleted', 'book_copy',
                              p_copy_id::text, 'success',
                              jsonb_build_object('book_id', v_book,
                                                 'files', coalesce(array_length(v_keys, 1), 0)));

  delete from public.ownership_events where book_copy_id = p_copy_id;
  delete from public.book_copies where id = p_copy_id;

  delete from public.books b
   where b.id = v_book
     and not exists (select 1 from public.book_copies c where c.book_id = b.id);

  return query select unnest(v_keys);
end $$;

revoke all on function public.delete_listing(uuid) from public, anon;
grant execute on function public.delete_listing(uuid) to authenticated;
