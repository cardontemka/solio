-- Removes the throwaway accounts used on 2026-09-06 to reproduce the phone's
-- symptoms over the local network. They own listings, so the plain auth delete
-- is refused by the foreign keys that protect ownership history; purge_user is
-- the path that clears them in order.

do $$
declare v_id uuid;
begin
  for v_id in
    select id from auth.users
     where email like 'lan%@example.invalid'
        or email like 'srv.%@example.invalid'
        or email like 'bl.%@example.invalid'
        or email like 'mob.%@example.invalid'
  loop
    raise notice '%', private.purge_user(v_id);
  end loop;
end $$;
