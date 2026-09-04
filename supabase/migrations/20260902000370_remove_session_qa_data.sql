-- Removes the throwaway accounts used on 2026-09-05 to verify the reworked
-- header, phone-sized image uploads, comment replies and the comment anchor in
-- notifications — along with the comment and notification one of those checks
-- left on a real listing.

delete from public.notifications n
 where n.type = 'comment_received'
   and exists (
     select 1 from public.comments c
      join public.profiles p on p.id = c.user_id
     where c.id = (n.payload->>'comment_id')::uuid
       and p.username like 'anb%');

delete from public.comments c
 using public.profiles p
 where p.id = c.user_id
   and (p.username like 'anb%' or p.username like 'cqa%' or p.username like 'cqb%');

do $$
declare v_id uuid;
begin
  for v_id in
    select id from auth.users
     where email like 'cq.%@example.invalid'
        or email like 'an.%@example.invalid'
        or email like 'perf.%@example.invalid'
        or email like 'nxt.%@example.invalid'
  loop
    raise notice '%', private.purge_user(v_id);
  end loop;
end $$;
