-- Storage points: cafés, libraries and shops that hold books for other people.
--
-- A storage point is an account, not a new kind of user table. It signs in the
-- same way, owns nothing by itself, and everything the site already does to a
-- profile — moderation, reports, a public page at /u/<username> — applies to it
-- unchanged. What it adds is a row of premises: where it is, when it is open,
-- how to reach it.
--
-- One point per account, enforced by a unique key rather than by convention:
-- "which of this café's three rows is the real one" is not a question worth
-- being able to ask.
--
-- What a listing gains is `stored_at`. It is deliberately just a pointer and a
-- date: this migration is the record of where a book physically is, not a
-- custody transfer. Ownership stays with the owner, `custodian_id` stays equal
-- to it, and handing custody to a venue — with the audit trail that would
-- need — is a later piece of work that this leaves room for.

create domain public.account_type as text
  constraint account_type_values check (value in ('person', 'storage_point'));

create domain public.storage_point_kind as text
  constraint storage_point_kind_values
  check (value in ('cafe', 'library', 'bookstore', 'coworking', 'school', 'other'));

alter table public.profiles
  add column account_type public.account_type not null default 'person';

create table public.storage_points (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null unique references public.profiles(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 120),
  kind        public.storage_point_kind not null default 'cafe',

  -- Everything a person needs to walk in and find their book. All required:
  -- a storage point that cannot be reached is not one.
  city        text not null check (length(btrim(city))     between 2 and 60),
  district    text not null check (length(btrim(district)) between 2 and 60),
  address     text not null check (length(btrim(address))  between 4 and 300),
  landmark    text check (landmark is null or length(btrim(landmark)) <= 200),
  phone       text not null check (phone ~ '^[0-9+()\-\s]{6,20}$'),
  hours       text not null check (length(btrim(hours))    between 2 and 200),

  -- Optional, and honestly optional: none of it stops somebody finding the door.
  capacity    int  check (capacity is null or capacity between 1 and 100000),
  website     text check (website is null or length(btrim(website)) <= 300),
  description text check (description is null or length(btrim(description)) <= 2000),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index storage_points_city_idx on public.storage_points (city, district);

-- Where a copy is being kept, if it is not with its owner.
alter table public.book_copies
  add column stored_at uuid references public.storage_points(id) on delete set null,
  add column stored_since timestamptz,
  add constraint book_copies_stored_stamp
    check ((stored_at is null) = (stored_since is null));

create index book_copies_stored_idx on public.book_copies (stored_at)
  where stored_at is not null;

-- ── Who may read and write one ────────────────────────────────────────────

alter table public.storage_points enable row level security;
grant select on public.storage_points to anon, authenticated;
grant update on public.storage_points to authenticated;

-- A storage point is a public place. The whole point of the row is that people
-- can find it, so it is world-readable exactly like the profile it belongs to,
-- and hidden on the same terms.
create policy storage_points_select_public on public.storage_points
  for select to anon, authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = profile_id
                    and (p.account_status = 'active' or private.is_staff())));

create policy storage_points_update_own on public.storage_points
  for update to authenticated
  using      (profile_id = (select auth.uid()) or private.is_staff())
  with check (profile_id = (select auth.uid()) or private.is_staff());

create or replace function private.storage_points_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.history_override() then return old; end if;
    raise exception 'STORAGE_POINTS_ARE_NOT_DELETED' using errcode = '42501',
      hint = 'Suspend the account instead.';
  end if;
  if not private.is_privileged_context() then
    if new.profile_id is distinct from old.profile_id
       or new.created_at is distinct from old.created_at then
      raise exception 'STORAGE_POINT_IMMUTABLE_FIELD' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger storage_points_guard_trg
  before update or delete on public.storage_points
  for each row execute function private.storage_points_guard();

-- ── Signing up as one ─────────────────────────────────────────────────────
-- The details travel in the signup metadata and the row is created by the same
-- trigger that creates the profile, so it works whether or not the address has
-- to be confirmed first — there is no session to write with until it is.

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_base text;
  v_username text;
  v_display text;
  v_try int := 0;
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_type text := coalesce(v_meta ->> 'account_type', 'person');
begin
  v_base := nullif(regexp_replace(lower(coalesce(v_meta->>'username',
                                                 split_part(new.email,'@',1))),
                                  '[^a-z0-9_]', '', 'g'), '');
  v_base := left(coalesce(v_base, 'user'), 20);
  if length(v_base) < 3 then
    v_base := v_base || 'user';
  end if;

  v_username := v_base;
  while exists (select 1 from public.profiles where lower(username) = lower(v_username)) loop
    v_try := v_try + 1;
    if v_try > 99 then
      v_username := left(v_base, 15) || substr(replace(new.id::text, '-', ''), 1, 8);
      exit;
    end if;
    v_username := v_base || v_try::text;
  end loop;

  -- A venue is called by its own name. The signup action already sends it as
  -- display_name, but the fallback matters for anything that does not — an
  -- account created straight from the API, or a seed — where the alternative is
  -- a café displayed as the local part of its email address.
  v_display := coalesce(
    case when v_type = 'storage_point' then nullif(btrim(v_meta->>'sp_name'), '') end,
    nullif(btrim(v_meta->>'display_name'), ''),
    nullif(btrim(v_meta->>'full_name'), ''),
    nullif(btrim(v_meta->>'name'), ''),
    nullif(btrim(split_part(new.email, '@', 1)), ''),
    'Шинэ хэрэглэгч');
  v_display := left(v_display, 60);

  if v_type not in ('person', 'storage_point') then
    v_type := 'person';
  end if;

  insert into public.profiles (id, username, display_name, city, account_type)
  values (new.id, v_username, v_display,
          case when v_type = 'storage_point'
               then nullif(btrim(v_meta->>'sp_city'), '') end,
          v_type);

  insert into public.user_roles (user_id, role) values (new.id, 'user');

  -- The premises. Only reached when the form said so, and every required field
  -- was checked by the action before signUp — a missing one here would fail the
  -- whole signup, so the CHECK is the backstop rather than the first line.
  if v_type = 'storage_point' then
    insert into public.storage_points
      (profile_id, name, kind, city, district, address, landmark, phone, hours,
       capacity, website, description)
    values (
      new.id,
      left(coalesce(nullif(btrim(v_meta->>'sp_name'), ''), v_display), 120),
      coalesce(nullif(btrim(v_meta->>'sp_kind'), ''), 'cafe'),
      left(coalesce(nullif(btrim(v_meta->>'sp_city'), ''), 'Улаанбаатар'), 60),
      left(coalesce(nullif(btrim(v_meta->>'sp_district'), ''), '—'), 60),
      left(coalesce(nullif(btrim(v_meta->>'sp_address'), ''), '—'), 300),
      left(nullif(btrim(v_meta->>'sp_landmark'), ''), 200),
      coalesce(nullif(btrim(v_meta->>'sp_phone'), ''), '00000000'),
      left(coalesce(nullif(btrim(v_meta->>'sp_hours'), ''), '—'), 200),
      case when v_meta->>'sp_capacity' ~ '^[0-9]{1,6}$'
           then (v_meta->>'sp_capacity')::int end,
      left(nullif(btrim(v_meta->>'sp_website'), ''), 300),
      left(nullif(btrim(v_meta->>'sp_description'), ''), 2000));
  end if;

  return new;
end $$;

-- ── Saying where a copy is kept ───────────────────────────────────────────
-- Its own function rather than a parameter on update_listing: this is a fact
-- about the physical object that the venue and the owner both act on, while
-- update_listing is about the description. Keeping them apart means marking a
-- book as dropped off does not touch the catalogue row or risk forking it.

create or replace function public.set_stored_at(p_copy_id uuid, p_point_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select owner_id into v_owner from public.book_copies where id = p_copy_id;
  if v_owner is null then
    raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_owner <> v_actor then
    raise exception 'NOT_YOUR_LISTING' using errcode = '42501';
  end if;

  if p_point_id is not null
     and not exists (select 1 from public.storage_points sp
                     join public.profiles p on p.id = sp.profile_id
                     where sp.id = p_point_id and p.account_status = 'active') then
    raise exception 'STORAGE_POINT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.book_copies
     set stored_at = p_point_id,
         stored_since = case when p_point_id is null then null else now() end
   where id = p_copy_id;

  perform private.write_audit(v_actor, 'listing.stored', 'book_copy', p_copy_id::text,
                              'success', jsonb_build_object('storage_point', p_point_id));
end $$;

revoke all on function public.set_stored_at(uuid, uuid) from public, anon;
grant execute on function public.set_stored_at(uuid, uuid) to authenticated;

-- The guard treats stored_at as owner-editable through the function above and
-- nothing else; a direct PostgREST update has no policy to reach it anyway.
create or replace function private.book_copies_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.history_override() then return old; end if;
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
    if new.stored_at is distinct from old.stored_at then
      raise exception 'STORAGE_IS_SET_BY_FUNCTION' using errcode = '42501',
        hint = 'Use public.set_stored_at().';
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

-- ── The list a listing form offers ────────────────────────────────────────

create or replace function public.list_storage_points()
returns table (
  id       uuid,
  username text,
  name     text,
  kind     text,
  city     text,
  district text,
  address  text,
  landmark text,
  phone    text,
  hours    text)
language sql stable security definer set search_path = ''
as $$
  select sp.id, p.username, sp.name, sp.kind::text, sp.city, sp.district, sp.address,
         sp.landmark, sp.phone, sp.hours
    from public.storage_points sp
    join public.profiles p on p.id = sp.profile_id
   where p.account_status = 'active'
   order by sp.city, sp.district, sp.name;
$$;

revoke all on function public.list_storage_points() from public;
grant execute on function public.list_storage_points() to anon, authenticated;

-- The shell asks who is calling once per page; whether they are a venue decides
-- what their own pages offer them, so it belongs in the same round trip rather
-- than in a second query on every render.
drop function if exists public.session_context();

create function public.session_context()
returns table (
  user_id        uuid,
  email          text,
  username       text,
  display_name   text,
  city           text,
  avatar_key     text,
  account_status text,
  account_type   text,
  is_staff       boolean,
  unread_count   int)
language sql stable security definer set search_path = ''
as $$
  select
    p.id,
    u.email::text,
    p.username,
    p.display_name,
    p.city,
    p.avatar_key,
    p.account_status::text,
    p.account_type::text,
    exists (select 1 from public.user_roles r
             where r.user_id = p.id and r.role in ('moderator','admin')),
    (select count(*)::int from public.notifications n
      where n.user_id = p.id and n.read_at is null)
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = (select auth.uid())
$$;

revoke all     on function public.session_context() from public;
grant  execute on function public.session_context() to anon, authenticated;

-- profiles_update_self has no column scope, so without this anybody could set
-- their own account_type and claim to be a venue. The claim would buy them
-- nothing — storage_points has no insert grant at all, so there would be no
-- premises behind it — but the app reads the flag to decide what to show, and a
-- profile that says "venue" with no address behind it is a bug waiting to be
-- found. The type is settled at signup and changed by staff or not at all.
create or replace function private.profiles_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.history_override() then return old; end if;
    raise exception 'PROFILES_ARE_NEVER_DELETED' using errcode = '42501';
  end if;
  if not private.is_privileged_context() then
    if new.account_status is distinct from old.account_status then
      raise exception 'ACCOUNT_STATUS_IS_STAFF_ONLY' using errcode = '42501';
    end if;
    if new.account_type is distinct from old.account_type then
      raise exception 'ACCOUNT_TYPE_IS_STAFF_ONLY' using errcode = '42501';
    end if;
    if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
      raise exception 'PROFILE_IMMUTABLE_FIELD' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
