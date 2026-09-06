-- Google sign-ups were all called "Шинэ хэрэглэгч".
--
-- handle_new_user only looked at raw_user_meta_data->>'display_name', which is
-- the field our own registration form writes. An OAuth provider fills in its
-- own vocabulary — Google sends full_name and name — so the lookup missed and
-- everyone landed on the fallback. The chain now tries the form's field first,
-- then the two Google uses, then the local part of the address, before giving
-- up on a generic label.
--
-- The username derivation gets the same treatment: a Google account has no
-- `username` in its metadata, so it fell through to the email prefix, which is
-- fine — that stays.

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_base text;
  v_username text;
  v_display text;
  v_try int := 0;
begin
  v_base := nullif(regexp_replace(lower(coalesce(new.raw_user_meta_data->>'username',
                                                 split_part(new.email,'@',1))),
                                  '[^a-z0-9_]', '', 'g'), '');
  v_base := left(coalesce(v_base, 'user'), 20);
  -- The column requires 3–24 characters; a one-letter mail prefix would fail.
  if length(v_base) < 3 then
    v_base := v_base || 'user';
  end if;

  v_username := v_base;
  while exists (select 1 from public.profiles where lower(username) = lower(v_username)) loop
    v_try := v_try + 1;
    if v_try > 99 then
      -- Give up being pretty rather than loop forever.
      v_username := left(v_base, 15) || substr(replace(new.id::text, '-', ''), 1, 8);
      exit;
    end if;
    v_username := v_base || v_try::text;
  end loop;

  v_display := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'name'), ''),
    nullif(btrim(split_part(new.email, '@', 1)), ''),
    'Шинэ хэрэглэгч');
  -- display_name is capped at 60 characters.
  v_display := left(v_display, 60);

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, v_display);

  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end $$;

-- Backfill the accounts that already carry the placeholder. Only rows the
-- provider actually named are touched; anybody who chose "Шинэ хэрэглэгч" for
-- themselves would have no name in their metadata to overwrite it with.
update public.profiles p
   set display_name = left(btrim(v.name), 60)
  from (
    select u.id,
           coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
                    nullif(btrim(u.raw_user_meta_data->>'name'), '')) as name
      from auth.users u
  ) v
 where v.id = p.id
   and v.name is not null
   and p.display_name = 'Шинэ хэрэглэгч';
