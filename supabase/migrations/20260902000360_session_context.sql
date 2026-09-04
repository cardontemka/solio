-- One round trip for everything the shell needs.
--
-- Every page was making five calls to Supabase before rendering anything:
-- the proxy validated the token, then the header called auth.getUser() again,
-- read the profile, counted unread notifications and looked up staff roles.
-- Against a database in another region that is most of the page's latency, and
-- none of it depends on which page is being viewed.
--
-- auth.uid() reads the JWT that PostgREST already verified, so this needs no
-- separate authentication step. SECURITY DEFINER because user_roles and
-- auth.users are not readable by the caller — the function still scopes every
-- row to auth.uid(), so it can only ever describe the person asking.

create or replace function public.session_context()
returns table (
  user_id        uuid,
  email          text,
  username       text,
  display_name   text,
  city           text,
  avatar_key     text,
  account_status text,
  is_staff       boolean,
  unread_count   int)
language sql stable security definer set search_path = ''
as $$
  select
    p.id,
    u.email::text,
    p.username,
    p.display_name,
    p.city,
    p.avatar_key,
    p.account_status::text,
    exists (select 1 from public.user_roles r
             where r.user_id = p.id and r.role in ('moderator','admin')),
    (select count(*)::int from public.notifications n
      where n.user_id = p.id and n.read_at is null)
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = (select auth.uid())
$$;

revoke all     on function public.session_context() from public;
-- anon may call it; with no JWT auth.uid() is null and it returns no rows.
grant  execute on function public.session_context() to anon, authenticated;
