-- A storage point gets a face.
--
-- A café is a place people decide whether to walk to, and until now the only
-- thing representing it anywhere on the site was its name in 15px type. A photo
-- of the room does more work than every field beside it: it says whether this
-- is a bookshop, a coffee counter or somebody's front room.
--
-- Stored the same way avatars and book photos are — a key into the image
-- bucket, never bytes in the database — so the object lifecycle, the MIME
-- sniffing and the CDN in front of it all stay where they already are.

alter table public.storage_points add column cover_key text;

-- The venue edits it through the same policy that covers the rest of its own
-- row (storage_points_update_own), and private.storage_points_guard still
-- refuses profile_id and created_at. Nothing new to grant.

-- The picker and the directory both read through this, so the photo has to come
-- with the rest of the row rather than in a second query per venue.
drop function if exists public.list_storage_points();

create function public.list_storage_points()
returns table (
  id        uuid,
  username  text,
  name      text,
  kind      text,
  city      text,
  district  text,
  address   text,
  landmark  text,
  phone     text,
  hours     text,
  cover_key text)
language sql stable security definer set search_path = ''
as $$
  select sp.id, p.username, sp.name, sp.kind::text, sp.city, sp.district, sp.address,
         sp.landmark, sp.phone, sp.hours, sp.cover_key
    from public.storage_points sp
    join public.profiles p on p.id = sp.profile_id
   where p.account_status = 'active'
   order by sp.city, sp.district, sp.name;
$$;

revoke all on function public.list_storage_points() from public;
grant execute on function public.list_storage_points() to anon, authenticated;
