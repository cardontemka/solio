-- Removes the throwaway accounts used on 2026-09-06 to verify the search
-- suggestions, the smaller listing photo and offering a book under a request.

do $$
declare v_id uuid;
begin
  for v_id in
    select id from auth.users
     where email like 'ui.%@example.invalid'
        or email like 'of.%@example.invalid'
        or email like 'gtest.%@example.invalid'
        or email like 'noname.%@example.invalid'
  loop
    raise notice '%', private.purge_user(v_id);
  end loop;
end $$;
