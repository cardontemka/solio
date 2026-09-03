-- A request is a post now, so it has to be readable by the people who might
-- answer it. book_requests_select_own scoped every row to its author, which
-- was right for a private wishlist and wrong for a feed.
--
-- Cancelled posts drop out of public view but stay visible to their author, the
-- same rule the rest of the site uses for moderated content.

drop policy book_requests_select_own on public.book_requests;

create policy book_requests_select_public on public.book_requests
  for select to anon, authenticated
  using (status <> 'cancelled'
         or user_id = (select auth.uid())
         or private.is_staff());

grant select on public.book_requests to anon;

-- The feed orders by recency; the old index led with user_id.
create index if not exists book_requests_feed_idx
  on public.book_requests (status, created_at desc, id desc);
