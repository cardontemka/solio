-- Removes the throwaway account used on 2026-09-04 to verify the listing model
-- end to end: feed cards, the merged listing page, comments without ratings,
-- user search, and editing a username.

do $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = 'listing.qa@example.invalid';
  if v_id is not null then
    raise notice '%', private.purge_user(v_id);
  end if;
end $$;
