-- Removes the throwaway accounts used on 2026-09-06 to verify the search
-- suggestions on a phone and the report → hide → resolve flow in the admin
-- panel, along with the report and listing that check created.

delete from public.reports r
 using public.profiles p
 where p.id = r.reporter_id and p.username like 'rp%';

do $$
declare v_id uuid;
begin
  for v_id in
    select id from auth.users
     where email like 'rp.%@example.invalid'
        or email like 'adm.%@example.invalid'
  loop
    raise notice '%', private.purge_user(v_id);
  end loop;
end $$;
