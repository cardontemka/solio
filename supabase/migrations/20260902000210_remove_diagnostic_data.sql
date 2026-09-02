-- Removes the throwaway account used on 2026-09-03 to reproduce the local
-- image-upload failure end to end (presign → PUT → publish → render). It
-- listed one book and one image on the cloud project; both go with it.
--
-- A no-op wherever that account does not exist, which is everywhere except
-- that one project.

do $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = 'diag.tester@example.invalid';
  if v_id is not null then
    raise notice '%', private.purge_user(v_id);
  end if;
end $$;
