-- Privileged operations. Each one checks the caller's role itself rather than
-- relying on the UI having hidden a button, and each writes an audit row —
-- including denials, so an attempt is visible even when it fails.

-- Denials are audited by the application layer, not here: PostgreSQL has no
-- autonomous transactions, so an INSERT followed by RAISE in the same function
-- is rolled back with the raise and would silently record nothing.
-- See src/features/moderation/actions.ts.
create or replace function private.require_staff(p_action text, p_entity text, p_id text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not private.is_staff() then
    raise exception 'STAFF_ONLY' using errcode = '42501';
  end if;
  return v_actor;
end $$;

-- Role of an arbitrary user (has_role only answers for the caller).
create or replace function private.has_role_for(p_user uuid, p_role public.app_role)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.user_roles
                      where user_id = p_user and role = p_role) $$;

-- ── Hide / restore user content ───────────────────────────────────────────
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

-- ── Suspend / restore an account ──────────────────────────────────────────
create or replace function public.moderate_profile(
  p_user_id uuid,
  p_status  public.account_status,
  p_reason  text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff('moderate.profile', 'profile', p_user_id::text);
  v_before public.account_status;
begin
  if p_user_id = v_actor then
    raise exception 'CANNOT_MODERATE_SELF' using errcode = '23514';
  end if;
  -- A moderator must not be able to silence an admin.
  if private.has_role_for(p_user_id, 'admin') and not private.has_role('admin') then
    raise exception 'CANNOT_MODERATE_ADMIN' using errcode = '42501';
  end if;

  select account_status into v_before from public.profiles where id = p_user_id;
  if v_before is null then
    raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.profiles set account_status = p_status where id = p_user_id;

  perform private.write_audit(v_actor, 'moderate.profile', 'profile', p_user_id::text,
    'success', jsonb_build_object('before', v_before, 'after', p_status, 'reason', p_reason));
  perform private.emit_event('moderation_action', 'profile', p_user_id,
                             array[p_user_id], v_actor);
end $$;

-- ── Resolve a report ──────────────────────────────────────────────────────
create or replace function public.resolve_report(
  p_report_id uuid,
  p_status    text,
  p_note      text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff('report.resolve', 'report', p_report_id::text);
  v_reporter uuid;
begin
  if p_status not in ('reviewing','resolved','dismissed') then
    raise exception 'INVALID_REPORT_STATUS' using errcode = '23514';
  end if;

  select reporter_id into v_reporter from public.reports where id = p_report_id;
  if v_reporter is null then
    raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.reports
     set status = p_status,
         resolution_note = p_note,
         resolved_by = case when p_status = 'reviewing' then null else v_actor end,
         resolved_at = case when p_status = 'reviewing' then null else now() end
   where id = p_report_id;

  perform private.write_audit(v_actor, 'report.' || p_status, 'report',
    p_report_id::text, 'success', jsonb_build_object('note', p_note));

  if p_status in ('resolved','dismissed') then
    perform private.emit_event('report_resolved', 'report', p_report_id,
                               array[v_reporter], v_actor);
  end if;
end $$;

-- ── Grant / revoke a role (admin only) ────────────────────────────────────
create or replace function public.admin_set_role(
  p_user_id uuid,
  p_role    public.app_role,
  p_grant   boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  -- Moderators cannot promote anyone, including themselves.
  if not private.has_role('admin') then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  if p_user_id = v_actor then
    raise exception 'CANNOT_CHANGE_OWN_ROLE' using errcode = '23514';
  end if;

  if p_grant then
    insert into public.user_roles (user_id, role, granted_by)
    values (p_user_id, p_role, v_actor)
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles where user_id = p_user_id and role = p_role;
  end if;

  perform private.write_audit(v_actor,
    case when p_grant then 'role.granted' else 'role.revoked' end,
    'profile', p_user_id::text, 'success', jsonb_build_object('role', p_role));
  perform private.emit_event('moderation_action', 'profile', p_user_id,
                             array[p_user_id], v_actor);
end $$;

revoke all on function public.moderate_entity(text,uuid,text,text)          from public, anon;
revoke all on function public.moderate_profile(uuid,public.account_status,text) from public, anon;
revoke all on function public.resolve_report(uuid,text,text)                from public, anon;
revoke all on function public.admin_set_role(uuid,public.app_role,boolean)  from public, anon;
grant execute on function public.moderate_entity(text,uuid,text,text)          to authenticated;
grant execute on function public.moderate_profile(uuid,public.account_status,text) to authenticated;
grant execute on function public.resolve_report(uuid,text,text)                to authenticated;
grant execute on function public.admin_set_role(uuid,public.app_role,boolean)  to authenticated;
