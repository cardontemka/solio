-- Removes the throwaway accounts used on 2026-09-05 to verify the header
-- rework, the push subscription rules and the notification read/push columns.

do $$
declare v_id uuid;
begin
  for v_id in
    select id from auth.users
     where email like 'hdr.%@example.invalid'
        or email like 'nq.%@example.invalid'
        or email like 'push.%@example.invalid'
        or email like 'readqa.%@example.invalid'
  loop
    raise notice '%', private.purge_user(v_id);
  end loop;
end $$;
