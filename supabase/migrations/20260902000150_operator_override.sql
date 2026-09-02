-- An operator escape hatch for the append-only guards.
--
-- The guards exist so that no application path — not even a leaked service
-- key — can rewrite ownership history or a completed transaction. That
-- guarantee should hold for the app. It should not lock the project owner out
-- of their own database during early operation.
--
-- The hatch is a session GUC that must be set explicitly, in the same
-- transaction, by a privileged connection:
--
--     begin;
--     set local solio.allow_history_mutation = 'on';
--     delete from public.ownership_events where book_copy_id = '…';
--     commit;
--
-- PostgREST cannot reach it: the Data API executes prepared statements, never
-- arbitrary SQL, so neither anon nor service_role can set the GUC. Only a
-- direct connection (Supabase SQL Editor, psql) can — and it must also be
-- running as postgres/supabase_admin.
--
-- `set local` means it dies with the transaction: it cannot be left switched
-- on by accident.

create or replace function private.history_override()
returns boolean language sql stable set search_path = ''
as $$
  select private.is_privileged_context()
     and coalesce(current_setting('solio.allow_history_mutation', true), 'off') = 'on'
$$;

-- ── Append-only tables ────────────────────────────────────────────────────
create or replace function private.solio_deny_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if private.history_override() then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception 'TABLE_IS_APPEND_ONLY: %', tg_table_name using errcode = '42501',
    hint = 'Operators: set local solio.allow_history_mutation = ''on'' in the same transaction.';
end $$;

-- ── Never-deleted business records ────────────────────────────────────────
create or replace function private.book_copies_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.history_override() then return old; end if;
    raise exception 'BOOK_COPIES_ARE_NEVER_DELETED' using errcode = '42501',
      hint = 'Deactivate with status = ''inactive'', or use the operator override.';
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

create or replace function private.swaps_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.history_override() then return old; end if;
    raise exception 'SWAPS_ARE_NEVER_DELETED' using errcode = '42501';
  end if;
  if private.history_override() then return new; end if;
  if not private.is_privileged_context() then
    raise exception 'DIRECT_SWAP_WRITE_FORBIDDEN' using errcode = '42501',
      hint = 'Swaps change only through request_swap/respond_to_swap/complete_swap.';
  end if;
  if old.status in ('COMPLETED','REJECTED','CANCELLED') then
    raise exception 'SWAP_IS_TERMINAL_%', old.status using errcode = '42501';
  end if;
  if new.requester_id is distinct from old.requester_id
     or new.responder_id is distinct from old.responder_id
     or new.created_at  is distinct from old.created_at then
    raise exception 'SWAP_IMMUTABLE_FIELD' using errcode = '23514';
  end if;
  if new.status is distinct from old.status
     and not private.is_valid_swap_edge(old.status, new.status) then
    raise exception 'INVALID_TRANSITION_%_TO_%', old.status, new.status
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

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

create or replace function private.reports_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.history_override() then return old; end if;
    raise exception 'REPORTS_ARE_NOT_DELETED' using errcode = '42501';
  end if;
  if not private.is_privileged_context() then
    raise exception 'REPORTS_ARE_RESOLVED_BY_STAFF' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.profiles_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Deleting an auth user cascades here; that path is legitimate.
    if private.is_privileged_context() then return old; end if;
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
    if private.is_privileged_context() then return old; end if;
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

-- Deleting an auth user should not be blocked by a book they once listed.
-- Ownership history keeps the profile row's id, so the chain stays readable.
alter table public.book_copies
  drop constraint book_copies_owner_id_fkey,
  add  constraint book_copies_owner_id_fkey
       foreign key (owner_id) references public.profiles(id) on delete cascade;
alter table public.book_copies
  drop constraint book_copies_custodian_id_fkey,
  add  constraint book_copies_custodian_id_fkey
       foreign key (custodian_id) references public.profiles(id) on delete cascade;
