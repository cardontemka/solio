-- Two fixes and a rule.
--
-- ── 1. Missing pictures ───────────────────────────────────────────────────
-- Three RPCs pick a listing's cover with `select bi.thumb_key ... limit 1`.
-- thumb_key is null for every photo uploaded before thumbnails existed, and for
-- any photo small enough that a second copy was pointless — makeThumb returns
-- null there on purpose. The listing queries have always fallen back to the
-- full-size key; these never did, so the claim list, the scan page and the
-- offers block showed blank covers for exactly those items.

create or replace function public.list_my_claims()
returns table (
  claim_id       uuid,
  copy_id        uuid,
  public_code    text,
  title          text,
  author         text,
  item_kind      text,
  cover_key      text,
  kind           text,
  status         text,
  note           text,
  created_at     timestamptz,
  expires_at     timestamptz,
  role           text,
  other_id       uuid,
  other_name     text,
  other_user     text,
  claimant_point text,
  owner_point    text)
language sql stable security definer set search_path = ''
as $$
  select cc.id, cc.copy_id, c.public_code, b.title, b.author, b.kind::text,
         (select coalesce(bi.thumb_key, bi.storage_key) from public.book_images bi
           where bi.book_copy_id = c.id and bi.status = 'ready'
           order by bi.sort_order limit 1),
         cc.kind::text,
         case when cc.status = 'pending' and cc.expires_at <= now()
              then 'expired' else cc.status::text end,
         cc.note, cc.created_at, cc.expires_at,
         case when cc.owner_id = (select auth.uid()) then 'owner' else 'claimant' end,
         other.id, other.display_name, other.username,
         cp.name, op.name
    from public.copy_claims cc
    join public.book_copies c on c.id = cc.copy_id
    join public.books b       on b.id = c.book_id
    join public.profiles other
      on other.id = case when cc.owner_id = (select auth.uid())
                         then cc.claimant_id else cc.owner_id end
    left join public.storage_points cp on cp.profile_id = cc.claimant_id
    left join public.storage_points op on op.profile_id = cc.owner_id
   where (select auth.uid()) in (cc.owner_id, cc.claimant_id)
   order by cc.created_at desc, cc.id desc
   limit 100;
$$;
revoke all on function public.list_my_claims() from public, anon;
grant execute on function public.list_my_claims() to authenticated;

-- A new column in the result, so the old signature has to go first.
drop function if exists public.find_copy_by_code(text);

create function public.find_copy_by_code(p_code text)
returns table (
  copy_id        uuid,
  public_code    text,
  title          text,
  author         text,
  kind           text,
  status         text,
  cover_key      text,
  owner_id       uuid,
  owner_name     text,
  owner_username text,
  stored_at_name text,
  has_open_claim boolean,
  owner_is_point boolean)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.public_code, b.title, b.author, b.kind::text, c.status::text,
         (select coalesce(bi.thumb_key, bi.storage_key) from public.book_images bi
           where bi.book_copy_id = c.id and bi.status = 'ready'
           order by bi.sort_order limit 1),
         c.owner_id, p.display_name, p.username,
         case when private.may_see_storage(c.id)
              then (select sp.name from public.copy_storage cs
                      join public.storage_points sp on sp.id = cs.point_id
                     where cs.copy_id = c.id) end,
         exists (select 1 from public.copy_claims cc
                  where cc.copy_id = c.id and cc.status = 'pending'
                    and cc.expires_at > now()),
         -- A venue's own book is taken with a credit, never swapped for; the
         -- page that draws the buttons has to know which it is looking at.
         exists (select 1 from public.storage_points sp where sp.profile_id = c.owner_id)
    from public.book_copies c
    join public.books b    on b.id = c.book_id
    join public.profiles p on p.id = c.owner_id
   where c.public_code = public.normalize_item_code(p_code)
     and c.moderation_status = 'active'
     and p.account_status = 'active';
$$;
revoke all on function public.find_copy_by_code(text) from public;
grant execute on function public.find_copy_by_code(text) to anon, authenticated;

create or replace function public.list_open_offers(p_copy_id uuid)
returns table (
  swap_id            uuid,
  offered_copy_id    uuid,
  offered_title      text,
  offered_author     text,
  offered_kind       text,
  offered_cover_key  text,
  requester_id       uuid,
  requester_username text,
  requester_name     text,
  created_at         timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.id, oc.id, ob.title, ob.author, ob.kind::text,
         (select coalesce(bi.thumb_key, bi.storage_key) from public.book_images bi
           where bi.book_copy_id = oc.id and bi.status = 'ready'
           order by bi.sort_order limit 1),
         p.id, p.username, p.display_name, s.created_at
    from public.swaps s
    join public.swap_items req on req.swap_id = s.id and req.side = 'requested'
    join public.swap_items off on off.swap_id = s.id and off.side = 'offered'
    join public.book_copies oc on oc.id = off.book_copy_id
    join public.books ob       on ob.id = oc.book_id
    join public.profiles p     on p.id = s.requester_id
   where req.book_copy_id = p_copy_id
     and s.status = 'REQUESTED'
     and oc.moderation_status = 'active'
     and p.account_status = 'active'
   order by s.created_at;
$$;
revoke all on function public.list_open_offers(uuid) from public;
grant execute on function public.list_open_offers(uuid) to anon, authenticated;

-- ── 2. A venue's books are not swapped for ────────────────────────────────
-- A book donated to a storage point is on that shelf for anybody with a credit
-- to come and take: scan the code, spend the credit, own it. Offering your own
-- book in exchange is a different transaction that the venue has no way to
-- complete — it is not a reader and does not want your novel. Refused here so a
-- stale page cannot start one.

create or replace function private.is_storage_point(p_profile uuid) returns boolean
language sql stable set search_path = ''
as $$ select exists (select 1 from public.storage_points sp where sp.profile_id = p_profile) $$;

create or replace function private.swap_guard_storage_point() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if private.is_storage_point(new.responder_id) or private.is_storage_point(new.requester_id) then
    raise exception 'POINT_ITEMS_ARE_BY_CREDIT' using errcode = '42501',
      hint = 'Take a storage point''s item with a credit instead of a swap.';
  end if;
  return new;
end $$;

create trigger swaps_no_storage_points
  before insert on public.swaps
  for each row execute function private.swap_guard_storage_point();
