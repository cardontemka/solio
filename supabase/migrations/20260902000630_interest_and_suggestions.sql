-- What this reader is actually interested in.
--
-- The category strip under the header is thirty-one headings in a fixed order
-- that nobody chose: "fiction" is first because it was typed first. For somebody
-- who only ever lists cookery books, the four headings they care about are off
-- the right-hand edge of a strip they have to drag. The same order is wrong for
-- everybody, in a different way each time.
--
-- Three signals, in descending order of how much they mean:
--
--   · what you list — you own it and you are giving it away, which is the
--     strongest statement anybody makes here about what they read;
--   · what you take — swapped for or claimed; the same statement, made by
--     acquiring rather than parting;
--   · what you click — a category chip, or a listing you opened. Weaker and
--     noisier, so weighted lower and aged out after six months.
--
-- Signed out there is no signal at all and none is invented: the strip falls
-- back to the headings with the most books actually on offer, which is the best
-- guess available and is also honest about what this site has.

-- ── Where clicks go ───────────────────────────────────────────────────────
-- Browsing history is the most sensitive thing this site stores. It is
-- therefore readable by its owner and by nobody else — not staff, not an admin
-- — and deletable by its owner, so "forget what I looked at" is a thing a
-- person can do. It is never joined into anything another reader can see.
create table public.interest_events (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         text not null check (kind in ('category_click', 'item_view')),
  category     text,
  book_copy_id uuid references public.book_copies(id) on delete cascade,
  occurred_at  timestamptz not null default now(),
  -- Each kind carries exactly the column it means, so a row cannot be a
  -- category click that names no category.
  constraint interest_events_shape check (
    (kind = 'category_click' and category is not null and book_copy_id is null) or
    (kind = 'item_view'      and book_copy_id is not null and category is null))
);

create index interest_events_user_idx
  on public.interest_events (user_id, occurred_at desc);

alter table public.interest_events enable row level security;

create policy interest_events_select_own on public.interest_events
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy interest_events_insert_own on public.interest_events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy interest_events_delete_own on public.interest_events
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.interest_events from anon, authenticated;
grant select, insert, delete on public.interest_events to authenticated;

/**
 * Record one click.
 *
 * Silent for a signed-out visitor rather than an error: the pages that call this
 * are public, nothing depends on the result, and a reader who is not signed in
 * simply leaves no trace. Same-second repeats of the same thing are dropped, so
 * a double-click or a re-render counts once.
 */
create or replace function public.record_interest(
  p_kind text,
  p_category text default null,
  p_copy_id uuid default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then return; end if;
  if p_kind not in ('category_click', 'item_view') then
    raise exception 'UNKNOWN_INTEREST_KIND' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.interest_events e
     where e.user_id = v_actor
       and e.kind = p_kind
       and e.category is not distinct from p_category
       and e.book_copy_id is not distinct from p_copy_id
       and e.occurred_at > now() - interval '1 minute') then
    return;
  end if;

  insert into public.interest_events (user_id, kind, category, book_copy_id)
  values (v_actor, p_kind,
          case when p_kind = 'category_click' then p_category end,
          case when p_kind = 'item_view' then p_copy_id end);
end $$;

revoke all on function public.record_interest(text, text, uuid) from public, anon;
grant execute on function public.record_interest(text, text, uuid) to authenticated;

-- ── The scores ────────────────────────────────────────────────────────────

/**
 * How much the caller has to do with each category, and how much the site does.
 *
 * Returned together because every caller needs both: the personal score decides
 * the order and the site-wide count breaks its many ties, which for a new
 * account is every tie there is.
 */
create or replace function private.category_scores(p_actor uuid)
returns table (category text, affinity numeric, available bigint)
language sql stable security definer set search_path = ''
as $$
  with
  -- Everything on offer, by heading. This is the whole ordering for somebody
  -- with no history, and the tiebreak for everybody else.
  supply as (
    select c.category, count(*) as n
      from public.book_copies bc
      join public.books b on b.id = bc.book_id
      cross join lateral unnest(b.categories) as c(category)
     where bc.status = 'available'
       and bc.moderation_status = 'active'
       and b.moderation_status = 'active'
     group by c.category
  ),
  -- What the caller has registered, and what they have been given. Both are
  -- ownership events pointing at them; the type says which.
  -- Listing and acquiring carry the same weight: the user asked for both, and
  -- there is no honest reason to believe one says more than the other.
  -- admin_correction is excluded — that is a moderator's act, not the reader's.
  owned as (
    select c.category, count(*) * 4 as w
      from public.ownership_events e
      join public.book_copies bc on bc.id = e.book_copy_id
      join public.books b on b.id = bc.book_id
      cross join lateral unnest(b.categories) as c(category)
     where p_actor is not null
       and e.to_owner_id = p_actor
       and e.event_type in ('initial_registration', 'swap_transfer', 'claim_transfer')
     group by c.category
  ),
  -- Clicks, which say less and are allowed to fade.
  clicked as (
    select e.category, count(*) * 2 as w
      from public.interest_events e
     where p_actor is not null
       and e.user_id = p_actor
       and e.kind = 'category_click'
       and e.occurred_at > now() - interval '180 days'
     group by e.category
  ),
  viewed as (
    select c.category, count(*) * 1 as w
      from public.interest_events e
      join public.book_copies bc on bc.id = e.book_copy_id
      join public.books b on b.id = bc.book_id
      cross join lateral unnest(b.categories) as c(category)
     where p_actor is not null
       and e.user_id = p_actor
       and e.kind = 'item_view'
       and e.occurred_at > now() - interval '180 days'
     group by c.category
  ),
  all_cats as (
    select category from supply
    union select category from owned
    union select category from clicked
    union select category from viewed
  )
  select a.category,
         (coalesce(o.w, 0) + coalesce(cl.w, 0) + coalesce(v.w, 0))::numeric,
         coalesce(s.n, 0)
    from all_cats a
    left join supply  s  on s.category  = a.category
    left join owned   o  on o.category  = a.category
    left join clicked cl on cl.category = a.category
    left join viewed  v  on v.category  = a.category;
$$;

/**
 * The category strip's order, best first.
 *
 * Personal score decides it; the number of books actually on offer breaks ties,
 * so a heading nobody has anything under sinks whatever the alphabet says. A
 * category the caller has a history with is returned even when nothing is on
 * offer under it right now — it is still what they read.
 */
create or replace function public.category_ranking()
returns table (category text, affinity numeric, available bigint)
language sql stable security definer set search_path = ''
as $$
  select s.category, s.affinity, s.available
    from private.category_scores((select auth.uid())) s
   order by s.affinity desc, s.available desc, s.category;
$$;
revoke all on function public.category_ranking() from public;
grant execute on function public.category_ranking() to anon, authenticated;

/**
 * "Books for you."
 *
 * A copy scores the affinity of every heading it carries, so a book in two
 * categories the reader likes beats one in either alone. Their own listings are
 * excluded — being shown your own book as a suggestion is the clearest possible
 * signal that nothing is being computed — as are the ones already spoken for.
 *
 * Returns nothing at all when the caller has no history. A row of "suggestions"
 * that is really just the newest listings renamed would be a lie told on the
 * front page, and the page is built to leave the section out entirely.
 */
create or replace function public.suggested_copies(p_limit int default 6)
returns table (copy_id uuid, score numeric)
language sql stable security definer set search_path = ''
as $$
  with actor as (select (select auth.uid()) as id),
  scores as (
    select s.category, s.affinity
      from private.category_scores((select id from actor)) s
     where s.affinity > 0
  )
  select bc.id, sum(sc.affinity) as score
    from public.book_copies bc
    join public.books b on b.id = bc.book_id
    cross join lateral unnest(b.categories) as c(category)
    join scores sc on sc.category = c.category
   where (select id from actor) is not null
     and bc.status = 'available'
     and bc.moderation_status = 'active'
     and b.moderation_status = 'active'
     and bc.owner_id <> (select id from actor)
   group by bc.id, bc.listed_at
   order by score desc, bc.listed_at desc, bc.id desc
   limit greatest(1, least(coalesce(p_limit, 6), 24));
$$;
revoke all on function public.suggested_copies(int) from public, anon;
grant execute on function public.suggested_copies(int) to authenticated;
