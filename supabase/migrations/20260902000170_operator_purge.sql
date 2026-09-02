-- Make operator deletion actually work, in two parts.
--
-- Part 1 — components follow their parent. A book_image without its copy, a
-- swap_item without its swap, an ownership_event without its copy: none of
-- these mean anything on their own, so RESTRICT there only produced a foreign
-- key error where a cascade was obviously wanted. Deleting a copy in the Table
-- Editor now works.
--
-- Part 2 — people do not. A profile stays RESTRICT-protected, because deleting
-- one silently would take ownership history with it, including the provenance
-- of copies that now belong to somebody else. Removing an account is a
-- deliberate act, so it gets a deliberate function instead of a cascade.
--
-- 20260902000150 made book_copies.owner_id CASCADE; that is reverted here. It
-- could never fire anyway (ownership_events still RESTRICTed the same delete),
-- so it read as permission the database did not actually grant.

alter table public.book_images
  drop constraint book_images_book_copy_id_fkey,
  add  constraint book_images_book_copy_id_fkey
       foreign key (book_copy_id) references public.book_copies(id) on delete cascade;

alter table public.swap_items
  drop constraint swap_items_swap_id_fkey,
  add  constraint swap_items_swap_id_fkey
       foreign key (swap_id) references public.swaps(id) on delete cascade;

alter table public.swap_items
  drop constraint swap_items_book_copy_id_fkey,
  add  constraint swap_items_book_copy_id_fkey
       foreign key (book_copy_id) references public.book_copies(id) on delete cascade;

alter table public.ownership_events
  drop constraint ownership_events_swap_id_fkey,
  add  constraint ownership_events_swap_id_fkey
       foreign key (swap_id) references public.swaps(id) on delete set null;

alter table public.book_copies
  drop constraint book_copies_owner_id_fkey,
  add  constraint book_copies_owner_id_fkey
       foreign key (owner_id) references public.profiles(id) on delete restrict;
alter table public.book_copies
  drop constraint book_copies_custodian_id_fkey,
  add  constraint book_copies_custodian_id_fkey
       foreign key (custodian_id) references public.profiles(id) on delete restrict;

-- oe_swap_transfer_has_swap requires swap_id on a swap_transfer row, which the
-- SET NULL above would violate. Deleting a swap is an operator act, so the
-- check now only constrains rows that still carry their swap.
alter table public.ownership_events drop constraint oe_swap_transfer_has_swap;
alter table public.ownership_events
  add constraint oe_swap_transfer_has_swap
  check (swap_id is null or event_type = 'swap_transfer');

-- ── Operator purge ────────────────────────────────────────────────────────
-- Lives in `private`, whose default privileges revoke EXECUTE from anon,
-- authenticated and service_role, and re-checks the caller besides. Only a
-- direct connection — Supabase SQL Editor or psql — can run these.
--
--     select private.purge_user('00000000-…');
--     select private.purge_book('00000000-…');

create or replace function private.purge_user(p_user uuid)
returns text language plpgsql security invoker set search_path = ''
as $$
declare v_copies int; v_email text;
begin
  if not private.history_override() then
    raise exception 'PURGE_IS_OPERATOR_ONLY' using errcode = '42501',
      hint = 'Run from the Supabase SQL Editor or psql, not the Data API.';
  end if;

  select email into v_email from auth.users where id = p_user;
  if v_email is null then
    raise exception 'NO_SUCH_USER: %', p_user using errcode = 'P0002';
  end if;

  -- Rows that RESTRICT the profile delete, in dependency order. Everything
  -- else either cascades from profiles or nulls out.
  delete from public.book_images  where uploaded_by = p_user;
  delete from public.book_reviews where user_id     = p_user;
  delete from public.reports      where reporter_id = p_user or resolved_by = p_user;
  delete from public.swaps        where requester_id = p_user
                                     or responder_id = p_user
                                     or confirmed_by = p_user;

  select count(*) into v_copies from public.book_copies
   where owner_id = p_user or custodian_id = p_user;

  delete from public.ownership_events
   where from_owner_id = p_user
      or to_owner_id   = p_user
      or book_copy_id in (select id from public.book_copies
                           where owner_id = p_user or custodian_id = p_user);
  delete from public.book_copies where owner_id = p_user or custodian_id = p_user;

  -- Books are shared catalogue entries, so only the ones nobody holds a copy
  -- of are removed; the rest keep their row with created_by set to null.
  delete from public.books b
   where b.created_by = p_user
     and not exists (select 1 from public.book_copies c where c.book_id = b.id);

  delete from auth.users where id = p_user;   -- cascades to public.profiles

  return format('purged %s (%s copies)', v_email, v_copies);
end $$;

create or replace function private.purge_book(p_book uuid)
returns text language plpgsql security invoker set search_path = ''
as $$
declare v_title text; v_copies int;
begin
  if not private.history_override() then
    raise exception 'PURGE_IS_OPERATOR_ONLY' using errcode = '42501';
  end if;

  select title into v_title from public.books where id = p_book;
  if v_title is null then
    raise exception 'NO_SUCH_BOOK: %', p_book using errcode = 'P0002';
  end if;

  select count(*) into v_copies from public.book_copies where book_id = p_book;

  delete from public.swaps s
   where exists (select 1 from public.swap_items i
                   join public.book_copies c on c.id = i.book_copy_id
                  where i.swap_id = s.id and c.book_id = p_book);
  delete from public.book_reviews where book_id = p_book;
  delete from public.book_copies  where book_id = p_book;  -- images, events cascade
  delete from public.books        where id      = p_book;

  return format('purged %L (%s copies)', v_title, v_copies);
end $$;
