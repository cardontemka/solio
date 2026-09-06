-- Removes the throwaway accounts used on 2026-09-07 to verify the category
-- filter, the new book measurements and the notification bell.

do $$
declare v_id uuid;
begin
  for v_id in
    select id from auth.users
     where email like 'cat.%@example.invalid'
        or email like 'rpc.%@example.invalid'
        or email like 'fm.%@example.invalid'
        or email like 'bl.%@example.invalid'
  loop
    raise notice '%', private.purge_user(v_id);
  end loop;
end $$;
