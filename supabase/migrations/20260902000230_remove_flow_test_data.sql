-- Removes the throwaway account used on 2026-09-04 to verify the reworked
-- Add Book flow end to end (form → book + copy → photo upload → copy page) and
-- to confirm that two listings of one ISBN stay two separate books.
--
-- Named explicitly rather than matched by pattern: the local seed also uses
-- @example.invalid addresses, and a pattern would wipe it on every reset.

do $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = 'flow.test@example.invalid';
  if v_id is not null then
    raise notice '%', private.purge_user(v_id);
  end if;
end $$;
