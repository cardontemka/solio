-- Public profile + role storage.
--
-- email/phone deliberately live only in auth.users, which PostgREST never
-- exposes. There is therefore no row in the exposed schema that can leak them.
--
-- Roles live in their own table, NOT on profiles: profiles needs a self-update
-- policy, and a column-scope mistake there would become privilege escalation.

create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  username       text not null check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name   text not null check (length(btrim(display_name)) between 1 and 60),
  avatar_key     text check (avatar_key is null or length(avatar_key) <= 200),
  bio            text check (bio is null or length(bio) <= 500),
  city           text check (city is null or length(city) <= 60),
  account_status public.account_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index profiles_username_key on public.profiles (lower(username));

create table public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ── Helpers ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER: called from RLS policies, so they must not be subject to
-- the policies they are evaluated inside (that would recurse, SQLSTATE 42P17).
-- search_path is pinned so a hostile schema cannot shadow these lookups.

create or replace function private.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.user_roles
                      where user_id = (select auth.uid()) and role = p_role) $$;

create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.user_roles
                      where user_id = (select auth.uid())
                        and role in ('moderator','admin')) $$;

create or replace function private.is_active_account()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles
                      where id = (select auth.uid()) and account_status = 'active') $$;

-- Not SECURITY DEFINER on purpose: current_user must reflect the real caller.
create or replace function private.is_privileged_context()
returns boolean language sql stable
as $$ select current_user in ('postgres','supabase_admin') $$;

-- ── Guard (review finding H2) ─────────────────────────────────────────────
-- profiles_update_self has no column scope, so without this a suspended user
-- could simply set account_status back to 'active'.

create or replace function private.profiles_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PROFILES_ARE_NEVER_DELETED' using errcode = '42501';
  end if;
  if not private.is_privileged_context() then
    if new.account_status is distinct from old.account_status then
      raise exception 'ACCOUNT_STATUS_IS_STAFF_ONLY' using errcode = '42501';
    end if;
    if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
      raise exception 'PROFILE_IMMUTABLE_FIELD' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_guard_trg before update or delete on public.profiles
  for each row execute function private.profiles_guard();

-- ── Signup ────────────────────────────────────────────────────────────────
-- Creates the profile + default role in the same transaction as the auth user.

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_base text;
  v_username text;
begin
  v_base := nullif(regexp_replace(lower(coalesce(new.raw_user_meta_data->>'username',
                                                 split_part(new.email,'@',1))),
                                  '[^a-z0-9_]', '', 'g'), '');
  v_username := left(coalesce(v_base,'user'), 15) || substr(replace(new.id::text,'-',''), 1, 8);

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username,
          coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'),''), 'Шинэ хэрэглэгч'));

  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
