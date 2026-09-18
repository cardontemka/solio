-- Searches, and what the totals look like from the office.
--
-- Two additions:
--
--   1. A search is a third kind of interest event. It is the plainest statement
--      anybody makes about what they want — plainer than a click, because it is
--      typed rather than picked from what was on offer — and until now it was
--      the one signal this site threw away.
--
--   2. Staff can read the totals. Not the rows: interest_events stays readable
--      by its owner alone, and these two functions return counts with no user
--      attached, no user id, and no way to ask "what did this person search
--      for". A moderator learns that eleven people looked for Харуки Мураками
--      and never which eleven.

alter table public.interest_events add column query text;

alter table public.interest_events drop constraint interest_events_shape;
alter table public.interest_events add constraint interest_events_shape check (
  (kind = 'category_click' and category is not null and book_copy_id is null and query is null) or
  (kind = 'item_view'      and book_copy_id is not null and category is null and query is null) or
  (kind = 'search'         and query is not null and category is null and book_copy_id is null));

alter table public.interest_events drop constraint interest_events_kind_check;
alter table public.interest_events add constraint interest_events_kind_check
  check (kind in ('category_click', 'item_view', 'search'));

-- Aggregating by the text means aggregating by its normalised form, or
-- "Мураками" and "мураками " are two different popular searches.
create index interest_events_query_idx
  on public.interest_events (lower(btrim(query)))
  where kind = 'search';

/**
 * Record one click, view or search.
 *
 * Replaces the three-argument version from migration 630 — a search carries text
 * rather than an id, and there was nowhere to put it.
 */
drop function if exists public.record_interest(text, text, uuid);

create or replace function public.record_interest(
  p_kind text,
  p_category text default null,
  p_copy_id uuid default null,
  p_query text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if v_actor is null then return; end if;
  if p_kind not in ('category_click', 'item_view', 'search') then
    raise exception 'UNKNOWN_INTEREST_KIND' using errcode = '23514';
  end if;
  if p_kind = 'search' then
    if v_query is null then return; end if;
    -- Long enough to mean something, short enough not to be a paste of a page.
    if pg_catalog.length(v_query) < 2 then return; end if;
    v_query := pg_catalog.left(v_query, 200);
  end if;

  -- The "have I just recorded this?" check below is a read followed by a write,
  -- and two of these arrive together often enough to matter: React runs an
  -- effect twice in development, a reader double-taps, two tabs open the same
  -- page. Without this both would look, both would find nothing, and one search
  -- would be counted as two people's worth of interest. The lock is per reader
  -- and held to the end of a transaction that does one insert.
  perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('solio.interest:' || v_actor::text, 0));

  if exists (
    select 1 from public.interest_events e
     where e.user_id = v_actor
       and e.kind = p_kind
       and e.category is not distinct from p_category
       and e.book_copy_id is not distinct from p_copy_id
       and e.query is not distinct from v_query
       and e.occurred_at > now() - interval '1 minute') then
    return;
  end if;

  insert into public.interest_events (user_id, kind, category, book_copy_id, query)
  values (v_actor, p_kind,
          case when p_kind = 'category_click' then p_category end,
          case when p_kind = 'item_view' then p_copy_id end,
          case when p_kind = 'search' then v_query end);
end $$;

revoke all on function public.record_interest(text, text, uuid, text) from public, anon;
grant execute on function public.record_interest(text, text, uuid, text) to authenticated;

-- ── What staff may see: totals, and only totals ───────────────────────────

/**
 * The most-searched terms, commonest first.
 *
 * Counted by distinct person, not by row: one reader searching the same title
 * on eleven evenings is one person looking for it, and ranking by raw hits would
 * let a single restless visitor set the whole list.
 */
create or replace function public.admin_top_searches(
  p_days int default 30,
  p_limit int default 20)
returns table (query text, searches bigint, people bigint)
language sql stable security definer set search_path = ''
as $$
  select pg_catalog.lower(pg_catalog.btrim(e.query)) as query,
         count(*),
         count(distinct e.user_id)
    from public.interest_events e
   where private.is_staff()
     and e.kind = 'search'
     and e.occurred_at > now() - (greatest(1, least(coalesce(p_days, 30), 365)) || ' days')::interval
   group by 1
   order by count(distinct e.user_id) desc, count(*) desc, 1
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;
revoke all on function public.admin_top_searches(int, int) from public, anon;
grant execute on function public.admin_top_searches(int, int) to authenticated;

/**
 * The most-opened listings, commonest first.
 *
 * Same rule: ranked by how many different people opened it. A listing that has
 * since been removed by a moderator drops out — it is not something staff should
 * be invited to click through to from a popularity chart.
 */
create or replace function public.admin_top_items(
  p_days int default 30,
  p_limit int default 20)
returns table (
  copy_id    uuid,
  title      text,
  author     text,
  item_kind  text,
  cover_key  text,
  owner_name text,
  views      bigint,
  people     bigint)
language sql stable security definer set search_path = ''
as $$
  select bc.id, b.title, b.author, b.kind::text,
         (select coalesce(bi.thumb_key, bi.storage_key) from public.book_images bi
           where bi.book_copy_id = bc.id and bi.status = 'ready'
           order by bi.sort_order limit 1),
         p.display_name,
         count(*),
         count(distinct e.user_id)
    from public.interest_events e
    join public.book_copies bc on bc.id = e.book_copy_id
    join public.books b        on b.id = bc.book_id
    join public.profiles p     on p.id = bc.owner_id
   where private.is_staff()
     and e.kind = 'item_view'
     and bc.moderation_status = 'active'
     and e.occurred_at > now() - (greatest(1, least(coalesce(p_days, 30), 365)) || ' days')::interval
   group by bc.id, b.title, b.author, b.kind, p.display_name
   order by count(distinct e.user_id) desc, count(*) desc, b.title
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;
revoke all on function public.admin_top_items(int, int) from public, anon;
grant execute on function public.admin_top_items(int, int) to authenticated;

/**
 * The most-clicked categories, commonest first. The third chart on the same
 * page, and the one that says what the strip under the header should lead with
 * for somebody nobody knows anything about yet.
 */
create or replace function public.admin_top_categories(
  p_days int default 30,
  p_limit int default 20)
returns table (category text, clicks bigint, people bigint, available bigint)
language sql stable security definer set search_path = ''
as $$
  with supply as (
    select c.category, count(*) as n
      from public.book_copies bc
      join public.books b on b.id = bc.book_id
      cross join lateral unnest(b.categories) as c(category)
     where bc.status = 'available' and bc.moderation_status = 'active'
       and b.moderation_status = 'active'
     group by c.category
  )
  select e.category, count(*), count(distinct e.user_id), coalesce(s.n, 0)
    from public.interest_events e
    left join supply s on s.category = e.category
   where private.is_staff()
     and e.kind = 'category_click'
     and e.occurred_at > now() - (greatest(1, least(coalesce(p_days, 30), 365)) || ' days')::interval
   group by e.category, s.n
   order by count(distinct e.user_id) desc, count(*) desc, e.category
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;
revoke all on function public.admin_top_categories(int, int) from public, anon;
grant execute on function public.admin_top_categories(int, int) to authenticated;
