-- What people actually want this month.
--
-- "Popular" on most sites means "looked at", which rewards a striking cover and
-- says nothing about whether anybody wanted the thing. Here there is a much
-- better signal available, because wanting something on Solio costs something:
--
--   · a swap offer — somebody put one of their own books on the table for it.
--     Nobody does that idly, and it is worth five of anything else;
--   · a claim — somebody said "this is in my hands now" or spent a credit on it;
--   · a view — somebody opened the page. Cheap, and weighted accordingly, but it
--     is the only signal a book gets before anybody is brave enough to ask.
--
-- Counted by distinct person, so one determined reader cannot make a book look
-- like a phenomenon, and confined to the calendar month, because "this month's"
-- is what the front page says.
--
-- The result is about books, never about readers: it returns copy ids and a
-- score, with every user id grouped away. That is what lets a signed-out visitor
-- see it at all while interest_events itself stays readable by its owner alone.

create or replace function public.demand_this_month(p_limit int default 6)
returns table (copy_id uuid, score numeric, wanted bigint)
language sql stable security definer set search_path = ''
as $$
  with since as (select date_trunc('month', now()) as t),
  offers as (
    select si.book_copy_id as copy_id, s.requester_id as person, 5 as w
      from public.swap_items si
      join public.swaps s on s.id = si.swap_id
     where si.side = 'requested'
       and s.created_at >= (select t from since)
  ),
  claims as (
    select cc.copy_id, cc.claimant_id as person, 5 as w
      from public.copy_claims cc
     where cc.created_at >= (select t from since)
  ),
  views as (
    select e.book_copy_id as copy_id, e.user_id as person, 1 as w
      from public.interest_events e
     where e.kind = 'item_view'
       and e.occurred_at >= (select t from since)
  ),
  -- One person counts once per kind of signal, however many times they did it:
  -- opening the same listing on six evenings is one reader who wants it.
  signals as (
    select copy_id, person, max(w) as w from (
      select * from offers union all select * from claims union all select * from views
    ) all_signals
    group by copy_id, person
  )
  select sg.copy_id,
         sum(sg.w)::numeric,
         count(distinct sg.person)
    from signals sg
    join public.book_copies bc on bc.id = sg.copy_id
    join public.books b on b.id = bc.book_id
   where bc.moderation_status = 'active'
     and b.moderation_status = 'active'
     -- A book that has already gone is not something anybody can act on, and a
     -- row of unavailable books under "most wanted" is a shop window of things
     -- that are sold.
     and bc.status = 'available'
   group by sg.copy_id
  having sum(sg.w) > 0
   order by sum(sg.w) desc, count(distinct sg.person) desc, sg.copy_id
   limit greatest(1, least(coalesce(p_limit, 6), 24));
$$;

revoke all on function public.demand_this_month(int) from public;
grant execute on function public.demand_this_month(int) to anon, authenticated;
