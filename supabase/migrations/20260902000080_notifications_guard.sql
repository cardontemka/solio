-- notifications_update_own has no column scope, so a recipient could rewrite
-- their own notification's type, entity or payload. Only read_at is theirs to
-- change; everything else is written by private.emit_event().
-- (Review finding L2.)

create or replace function private.notifications_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
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

create trigger notifications_guard_trg before update or delete on public.notifications
  for each row execute function private.notifications_guard();
