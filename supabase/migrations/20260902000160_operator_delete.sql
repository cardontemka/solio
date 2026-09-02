-- Simplify the operator escape hatch added in 20260902000150.
--
-- That migration required an explicit `set local solio.allow_history_mutation`.
-- Correct, but unusable: Supabase Studio's Table Editor issues a bare DELETE,
-- so the owner still could not click the trash icon on a row. The GUC made the
-- hatch exist without making it reachable.
--
-- The line that actually matters is not "postgres vs everyone" but "a direct
-- database connection vs the Data API". PostgREST executes as anon,
-- authenticated or service_role — never as postgres — so gating on the role
-- alone already blocks every path an application user can reach, including a
-- leaked service key. Reaching postgres means holding the database password or
-- a Studio session, which is the operator by definition.
--
-- supabase_auth_admin is included so that deleting an auth user cascades
-- cleanly; GoTrue runs as that role.

create or replace function private.history_override()
returns boolean language sql stable set search_path = ''
as $$ select current_user in ('postgres','supabase_admin','supabase_auth_admin') $$;

-- profiles and notifications guard on is_privileged_context(), which excludes
-- supabase_auth_admin; route their DELETE branches through the same override
-- so that deleting an auth user is not blocked by its own cascade.
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
    if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
      raise exception 'PROFILE_IMMUTABLE_FIELD' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function private.notifications_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.history_override() then return old; end if;
    raise exception 'NOTIFICATIONS_ARE_NOT_DELETED' using errcode = '42501';
  end if;
  if not private.is_privileged_context() then
    if new.user_id     is distinct from old.user_id
       or new.type        is distinct from old.type
       or new.entity_type is distinct from old.entity_type
       or new.entity_id   is distinct from old.entity_id
       or new.payload     is distinct from old.payload
       or new.created_at  is distinct from old.created_at then
      raise exception 'ONLY_READ_STATE_IS_EDITABLE' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Deleting a copy should take its own history with it rather than being
-- refused; the audit_logs trail is separate and stays.
alter table public.ownership_events
  drop constraint ownership_events_book_copy_id_fkey,
  add  constraint ownership_events_book_copy_id_fkey
       foreign key (book_copy_id) references public.book_copies(id) on delete cascade;
