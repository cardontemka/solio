-- The owner of a listing may now edit it and delete it.
--
-- Deleting was refused outright: book_copies_guard raised
-- BOOK_COPIES_ARE_NEVER_DELETED for everyone except a direct database
-- connection, on the reasoning that a copy is the anchor of an ownership
-- chain. That reasoning holds for a copy that has actually moved between
-- people. It does not hold for the ordinary case this site is made of —
-- somebody listed their own book and wants it gone.
--
-- So the rule becomes conditional rather than absolute: a listing may be
-- deleted by its owner unless it is committed to a live swap. Everything that
-- hangs off it (photos, comments, ownership events, swap items) already
-- cascades. The catalogue row goes too when nothing else points at it, so a
-- deleted listing does not leave a ghost in search.
--
-- Editing goes through an RPC because a listing is two rows: the catalogue
-- fields live on `books`, the physical ones on `book_copies`, and `books` has
-- no update policy at all — it is written only by the RPCs that own it.

create or replace function private.book_copies_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.history_override() then return old; end if;
    -- Reached through public.delete_listing(), which has already checked
    -- ownership and that no live swap depends on this row.
    if old.owner_id = (select auth.uid()) then return old; end if;
    raise exception 'NOT_YOUR_LISTING' using errcode = '42501';
  end if;

  if not private.is_privileged_context() then
    if new.owner_id is distinct from old.owner_id
       or new.custodian_id is distinct from old.custodian_id then
      raise exception 'OWNERSHIP_CHANGE_FORBIDDEN' using errcode = '42501',
        hint = 'Ownership changes only through public.complete_swap().';
    end if;
    if new.book_id is distinct from old.book_id
       or new.created_at is distinct from old.created_at
       or new.transfer_count is distinct from old.transfer_count then
      raise exception 'COPY_IMMUTABLE_FIELD' using errcode = '23514';
    end if;
    if new.moderation_status is distinct from old.moderation_status then
      raise exception 'MODERATION_IS_STAFF_ONLY' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and (old.status, new.status) not in
           (('available','inactive'), ('inactive','available'),
            ('swapped','available'),  ('swapped','inactive')) then
      raise exception 'INVALID_COPY_TRANSITION_%_TO_%', old.status, new.status
        using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create policy book_copies_delete_own on public.book_copies
  for delete to authenticated
  using (owner_id = (select auth.uid()));

grant delete on public.book_copies to authenticated;

-- ── Delete a listing ──────────────────────────────────────────────────────
create or replace function public.delete_listing(p_copy_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_book  uuid;
  v_live  int;
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

  perform private.write_audit(v_actor, 'listing.deleted', 'book_copy',
                              p_copy_id::text, 'success',
                              jsonb_build_object('book_id', v_book));

  -- Photos, comments, ownership events and swap items all cascade from here.
  delete from public.book_copies where id = p_copy_id;

  -- Leave no orphan in search: the catalogue row exists only to back listings.
  delete from public.books b
   where b.id = v_book
     and not exists (select 1 from public.book_copies c where c.book_id = b.id)
     and not exists (select 1 from public.comments   m where m.book_copy_id in
                      (select id from public.book_copies where book_id = b.id));
end $$;

revoke all     on function public.delete_listing(uuid) from public, anon;
grant  execute on function public.delete_listing(uuid) to authenticated;

-- ── Edit a listing ────────────────────────────────────────────────────────
create or replace function public.update_listing(
  p_copy_id        uuid,
  p_title          text,
  p_author         text default null,
  p_isbn           text default null,
  p_publisher      text default null,
  p_language       text default null,
  p_description    text default null,
  p_published_year int  default null,
  p_condition      public.book_condition default 'good',
  p_condition_note text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_book  uuid;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'TITLE_REQUIRED' using errcode = '23514';
  end if;

  select owner_id, book_id into v_owner, v_book
    from public.book_copies where id = p_copy_id;
  if v_owner is null then
    raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_owner <> v_actor then
    raise exception 'NOT_YOUR_LISTING' using errcode = '42501';
  end if;

  -- Safe because a books row backs exactly one listing (ADR-030): editing it
  -- cannot rewrite anybody else's listing.
  update public.books
     set title        = btrim(p_title),
         author       = nullif(btrim(coalesce(p_author,'')),''),
         isbn         = nullif(btrim(coalesce(p_isbn,'')),''),
         publisher    = nullif(btrim(coalesce(p_publisher,'')),''),
         language     = nullif(btrim(coalesce(p_language,'')),''),
         description  = nullif(btrim(coalesce(p_description,'')),''),
         published_at = case when p_published_year is null then null
                             else make_date(p_published_year, 1, 1) end,
         updated_at   = now()
   where id = v_book;

  update public.book_copies
     set condition      = p_condition,
         condition_note = nullif(btrim(coalesce(p_condition_note,'')),'')
   where id = p_copy_id;

  perform private.write_audit(v_actor, 'listing.updated', 'book_copy',
                              p_copy_id::text, 'success',
                              jsonb_build_object('book_id', v_book));
end $$;

revoke all     on function public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text) from public, anon;
grant  execute on function public.update_listing(uuid,text,text,text,text,text,text,int,public.book_condition,text) to authenticated;
