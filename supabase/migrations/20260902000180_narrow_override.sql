-- Narrow the operator override to what was actually asked for: deletion.
--
-- 20260902000150 put the override at the top of swaps_guard, before the
-- transition check. Every swap RPC is SECURITY DEFINER and therefore runs as
-- postgres, so that one line disabled is_valid_swap_edge() for the only code
-- that ever updates a swap — the state machine stopped being enforced. The
-- override belongs in the DELETE branch alone.
--
-- The same reasoning trims solio_deny_mutation: removing a row is an operator
-- act, rewriting one in place is not. ownership_events and audit_logs stay
-- update-proof for every role, so history is still never silently altered.

create or replace function private.solio_deny_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op in ('DELETE','TRUNCATE') and private.history_override() then
    return old;
  end if;
  raise exception 'TABLE_IS_APPEND_ONLY: %', tg_table_name using errcode = '42501',
    hint = 'Rows may be removed by an operator (postgres), never rewritten.';
end $$;

create or replace function private.swaps_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.history_override() then return old; end if;
    raise exception 'SWAPS_ARE_NEVER_DELETED' using errcode = '42501';
  end if;

  -- No override past this point: the RPCs run as postgres, so anything
  -- exempted here would exempt the application itself.
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
