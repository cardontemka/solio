-- Book reviews.
--
-- This rates the WORK, not the transaction — a reader may have borrowed the
-- book elsewhere and still have something worth saying, and requiring a
-- completed swap first would leave every new book's page empty (ADR-022).
--
-- User reliability is a different concept and gets its own table later; the
-- two are deliberately not conflated here.

create table public.book_reviews (
  id                uuid primary key default gen_random_uuid(),
  book_id           uuid not null references public.books(id)    on delete restrict,
  user_id           uuid not null references public.profiles(id) on delete restrict,
  rating            smallint not null check (rating between 1 and 5),
  body              text check (body is null or length(body) <= 4000),
  moderation_status public.content_moderation_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- The constraint IS the feature: one voice per person per book. A second
  -- attempt returns 23505, which the UI turns into "edit yours instead".
  constraint book_reviews_one_per_user_book unique (user_id, book_id)
);

create index book_reviews_book_idx on public.book_reviews (book_id, created_at desc);

create or replace function private.book_reviews_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;   -- withdrawing your own opinion carries no history obligation
  end if;
  if not private.is_privileged_context() then
    if new.user_id is distinct from old.user_id
       or new.book_id is distinct from old.book_id
       or new.created_at is distinct from old.created_at then
      raise exception 'REVIEW_IMMUTABLE_FIELD' using errcode = '42501';
    end if;
    if new.moderation_status is distinct from old.moderation_status then
      raise exception 'MODERATION_IS_STAFF_ONLY' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger book_reviews_guard_trg before update or delete on public.book_reviews
  for each row execute function private.book_reviews_guard();

alter table public.book_reviews enable row level security;
grant select, insert, update, delete on public.book_reviews to authenticated;
grant select on public.book_reviews to anon;

create policy book_reviews_select_public on public.book_reviews
  for select to anon, authenticated
  using (moderation_status = 'active'
         or user_id = (select auth.uid())
         or private.is_staff());

-- SECURITY DEFINER for the same reason as private.report_rate_ok(): reading
-- book_reviews inline from a policy on book_reviews is a self-referential
-- lookup and raises 42P17.
create or replace function private.review_rate_ok()
returns boolean language sql stable security definer set search_path = ''
as $$
  select count(*) < 10 from public.book_reviews
   where user_id = (select auth.uid())
     and created_at > now() - interval '1 hour'
$$;

create policy book_reviews_insert_own on public.book_reviews
  for insert to authenticated
  with check (user_id = (select auth.uid())
              and private.is_active_account()
              and private.review_rate_ok());

create policy book_reviews_update_own on public.book_reviews
  for update to authenticated
  using      (user_id = (select auth.uid()) or private.is_staff())
  with check (user_id = (select auth.uid()) or private.is_staff());

create policy book_reviews_delete_own on public.book_reviews
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Let moderators act on reviews through the same entry point as other content.
create or replace function public.moderate_entity(
  p_entity_type text,
  p_entity_id   uuid,
  p_status      text,
  p_reason      text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff('moderate.' || p_entity_type, p_entity_type, p_entity_id::text);
  v_before text;
begin
  if p_status not in ('active','hidden','removed') then
    raise exception 'INVALID_MODERATION_STATUS' using errcode = '23514';
  end if;

  case p_entity_type
    when 'book' then
      select moderation_status into v_before from public.books where id = p_entity_id;
      update public.books set moderation_status = p_status where id = p_entity_id;
    when 'book_copy' then
      select moderation_status into v_before from public.book_copies where id = p_entity_id;
      update public.book_copies set moderation_status = p_status where id = p_entity_id;
    when 'review' then
      select moderation_status into v_before from public.book_reviews where id = p_entity_id;
      update public.book_reviews set moderation_status = p_status where id = p_entity_id;
    when 'book_image' then
      select status::text into v_before from public.book_images where id = p_entity_id;
      update public.book_images
         set status = case when p_status = 'active' then 'ready' else 'removed' end
       where id = p_entity_id;
    else
      raise exception 'UNSUPPORTED_ENTITY_TYPE' using errcode = '23514';
  end case;

  if v_before is null then
    raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform private.write_audit(v_actor, 'moderate.' || p_entity_type, p_entity_type,
    p_entity_id::text, 'success',
    jsonb_build_object('before', v_before, 'after', p_status, 'reason', p_reason));
end $$;

-- Notify the people who own a copy of the reviewed book, so a review reaches
-- the person it most affects. Capped: a popular book must not fan out forever.
-- In `public` because PostgREST only exposes that schema, but executable ONLY
-- by service_role: the recipient list is derived here, never chosen by a client.
create or replace function public.notify_review(p_book_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_recipients uuid[];
begin
  select array_agg(distinct c.owner_id) into v_recipients
    from (select owner_id from public.book_copies
           where book_id = p_book_id and status = 'available'
             and moderation_status = 'active'
             and owner_id is distinct from p_actor
           limit 20) c;

  if v_recipients is not null then
    perform private.emit_event('review_received', 'book', p_book_id, v_recipients, p_actor);
  end if;
end $$;

-- Called from the server with the service key after a review is created, not
-- by the client: the recipient list is derived, not chosen.
revoke all     on function public.notify_review(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.notify_review(uuid, uuid) to service_role;
