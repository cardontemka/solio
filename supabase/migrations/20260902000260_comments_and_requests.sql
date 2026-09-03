-- Two concepts are corrected here, and the names are brought in line with them.
--
-- ── Comments ──────────────────────────────────────────────────────────────
-- book_reviews held plain comments keyed on `books`. Two problems: the name is
-- wrong and reserves the one that real reviews will want later, and keying on
-- `books` meant every listing sharing a catalogue row shared a thread. A
-- comment belongs to the thing on screen.
--
-- One `comments` table with an exclusive arc rather than two near-identical
-- tables: listings and requests need exactly the same rules — one rate limit,
-- one guard, one RLS set — and the arc keeps a real foreign key to each parent.
--
-- ── Requests ──────────────────────────────────────────────────────────────
-- book_requests tried to be a wishlist with automatic matching: it linked to a
-- catalogue row and a trigger announced "your book appeared". Neither survives
-- ADR-030 — there is no shared catalogue to link to — and the matching was
-- never what people wanted. A request is now a post: someone says what they are
-- looking for, and other people answer underneath.

-- ── 1. Out with book_reviews ──────────────────────────────────────────────
drop table if exists public.book_reviews cascade;
drop function if exists private.book_reviews_guard() cascade;
drop function if exists private.review_rate_ok() cascade;
drop function if exists public.notify_review(uuid, uuid) cascade;

-- ── 2. Requests become posts ──────────────────────────────────────────────
drop function if exists private.match_book_requests(uuid, uuid) cascade;
drop index if exists public.book_requests_no_dup;
drop index if exists public.book_requests_book_idx;
drop index if exists public.notifications_wishlist_once;

alter table public.book_requests
  drop constraint if exists book_requests_matched_stamp,
  drop constraint if exists book_requests_target,
  drop column if exists matched_book_id,
  drop column if exists matched_at,
  drop column if exists book_id;

-- A post needs something to read.
alter table public.book_requests
  alter column title set not null,
  add constraint book_requests_title_required
    check (length(btrim(title)) between 1 and 300);

create or replace function private.book_requests_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;   -- deleting your own post carries no history obligation
  end if;
  if not private.is_privileged_context() then
    if new.user_id is distinct from old.user_id
       or new.created_at is distinct from old.created_at then
      raise exception 'REQUEST_IMMUTABLE_FIELD' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- The matcher was the only reason book creation touched requests at all.
create or replace function public.create_book_with_copy(
  p_title          text,
  p_author         text default null,
  p_isbn           text default null,
  p_publisher      text default null,
  p_language       text default null,
  p_description    text default null,
  p_published_year int  default null,
  p_condition      public.book_condition default 'good',
  p_condition_note text default null)
returns table (book_id uuid, copy_id uuid)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_book_id uuid;
  v_copy_id uuid;
  v_recent int;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles
                  where id = v_actor and account_status = 'active') then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  select count(*) into v_recent from public.book_copies
   where owner_id = v_actor and created_at > now() - interval '24 hours';
  if v_recent >= 30 then
    raise exception 'RATE_LIMIT_BOOK_CREATE' using errcode = '54000';
  end if;

  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'TITLE_REQUIRED' using errcode = '23514';
  end if;

  insert into public.books (title, author, isbn, publisher, language,
                            description, published_at, created_by)
  values (btrim(p_title), nullif(btrim(coalesce(p_author,'')),''),
          nullif(btrim(coalesce(p_isbn,'')),''),
          nullif(btrim(coalesce(p_publisher,'')),''),
          nullif(btrim(coalesce(p_language,'')),''),
          nullif(btrim(coalesce(p_description,'')),''),
          case when p_published_year is null then null
               else make_date(p_published_year, 1, 1) end,
          v_actor)
  returning id into v_book_id;

  insert into public.book_copies (book_id, owner_id, custodian_id,
                                  condition, condition_note)
  values (v_book_id, v_actor, v_actor, p_condition,
          nullif(btrim(coalesce(p_condition_note,'')),''))
  returning id into v_copy_id;

  insert into public.ownership_events (book_copy_id, from_owner_id, to_owner_id,
                                       event_type, actor_id)
  values (v_copy_id, null, v_actor, 'initial_registration', v_actor);

  perform private.write_audit(v_actor, 'book_copy.created', 'book_copy',
                              v_copy_id::text, 'success',
                              jsonb_build_object('book_id', v_book_id));

  return query select v_book_id, v_copy_id;
end $$;

revoke all     on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text) from public, anon;
grant  execute on function public.create_book_with_copy(text,text,text,text,text,text,int,public.book_condition,text) to authenticated;

-- ── 3. Entity vocabularies ────────────────────────────────────────────────
alter table public.notifications
  drop constraint notifications_entity_type_check,
  add  constraint notifications_entity_type_check
    check (entity_type in ('swap','book','book_copy','comment','request','report','profile'));
alter table public.notifications
  drop constraint notifications_type_check,
  add  constraint notifications_type_check
    check (type in (
      'swap_requested','swap_accepted','swap_rejected','swap_cancelled',
      'swap_confirmed','swap_completed',
      'comment_received','report_resolved','moderation_action'));

alter table public.reports
  drop constraint reports_entity_type_check,
  add  constraint reports_entity_type_check
    check (entity_type in ('book','book_copy','comment','request','profile','swap'));

-- ── 4. The comments table ─────────────────────────────────────────────────
create table public.comments (
  id           uuid primary key default gen_random_uuid(),
  -- Exactly one parent. A comment on a listing and a comment on a request are
  -- the same thing to a reader and to moderation; only the parent differs.
  book_copy_id uuid references public.book_copies(id)   on delete cascade,
  request_id   uuid references public.book_requests(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete restrict,
  body         text not null check (length(btrim(body)) between 1 and 4000),
  moderation_status public.content_moderation_status not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint comments_one_parent check (num_nonnulls(book_copy_id, request_id) = 1)
);

create index comments_copy_idx on public.comments (book_copy_id, created_at desc)
  where book_copy_id is not null;
create index comments_request_idx on public.comments (request_id, created_at desc)
  where request_id is not null;
create index comments_user_idx on public.comments (user_id, created_at desc);

create or replace function private.comments_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;   -- withdrawing your own words carries no history obligation
  end if;
  if not private.is_privileged_context() then
    if new.user_id      is distinct from old.user_id
       or new.book_copy_id is distinct from old.book_copy_id
       or new.request_id   is distinct from old.request_id
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

create trigger comments_guard_trg
  before insert or update or delete on public.comments
  for each row execute function private.comments_guard();

-- SECURITY DEFINER because the policy that calls it reads the same table it
-- guards; inline, that recursion is a 42P17.
create or replace function private.comment_rate_ok()
returns boolean language sql stable security definer set search_path = ''
as $$
  select count(*) < 10 from public.comments
   where user_id = (select auth.uid())
     and created_at > now() - interval '1 hour'
$$;

alter table public.comments enable row level security;
alter table public.comments force  row level security;

create policy comments_select_visible on public.comments
  for select to anon, authenticated
  using (moderation_status = 'active'
         or user_id = (select auth.uid())
         or private.is_staff());

create policy comments_insert_own on public.comments
  for insert to authenticated
  with check (user_id = (select auth.uid())
              and private.is_active_account()
              and private.comment_rate_ok());

create policy comments_update_own on public.comments
  for update to authenticated
  using      (user_id = (select auth.uid()) or private.is_staff())
  with check (user_id = (select auth.uid()) or private.is_staff());

create policy comments_delete_own on public.comments
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.comments to authenticated;
grant select on public.comments to anon;

-- ── 5. Moderation reaches the new tables ──────────────────────────────────
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
    when 'comment' then
      select moderation_status into v_before from public.comments where id = p_entity_id;
      update public.comments set moderation_status = p_status where id = p_entity_id;
    when 'request' then
      select status::text into v_before from public.book_requests where id = p_entity_id;
      update public.book_requests
         set status = case when p_status = 'active' then 'open' else 'cancelled' end
       where id = p_entity_id;
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

revoke all     on function public.moderate_entity(text,uuid,text,text) from public, anon;
grant  execute on function public.moderate_entity(text,uuid,text,text) to authenticated;

-- ── 6. Telling the person who is being answered ───────────────────────────
-- In `public` because PostgREST only exposes that schema, but executable ONLY
-- by service_role: the recipient is derived here, never chosen by a client.
create or replace function public.notify_comment(p_comment_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_copy_id    uuid;
  v_request_id uuid;
  v_recipient  uuid;
begin
  select book_copy_id, request_id into v_copy_id, v_request_id
    from public.comments where id = p_comment_id;

  if v_copy_id is not null then
    select owner_id into v_recipient from public.book_copies where id = v_copy_id;
    if v_recipient is not null and v_recipient is distinct from p_actor then
      perform private.emit_event('comment_received', 'book_copy', v_copy_id,
                                 array[v_recipient], p_actor);
    end if;
  elsif v_request_id is not null then
    select user_id into v_recipient from public.book_requests where id = v_request_id;
    if v_recipient is not null and v_recipient is distinct from p_actor then
      perform private.emit_event('comment_received', 'request', v_request_id,
                                 array[v_recipient], p_actor);
    end if;
  end if;
end $$;

revoke all     on function public.notify_comment(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.notify_comment(uuid, uuid) to service_role;
