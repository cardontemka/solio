-- A notification that arrives only when the page is reloaded is not a
-- notification; it is a thing you find later.
--
-- The row already exists the moment anything happens — every RPC on this site
-- ends with private.emit_event — so the missing half is purely delivery. This
-- puts `notifications` in the realtime publication, which lets a signed-in tab
-- hold one websocket and be told about its own rows as they are written.
--
-- ── What this does not do ─────────────────────────────────────────────────
-- No polling, no second table, no server work per open tab beyond the socket
-- itself. Postgres already writes these rows to the WAL; realtime reads that
-- stream once for the whole project and fans it out, so the cost of an idle
-- reader is a parked connection rather than a query every few seconds.
--
-- RLS still decides what reaches whom: realtime evaluates the same policies as
-- a select, so a subscriber is only ever handed rows their own policy would
-- return. The client filters on user_id as well, which saves the server the
-- work of checking rows that were never going to pass.

alter publication supabase_realtime add table public.notifications;

-- Realtime needs the whole row to evaluate RLS against it; the default replica
-- identity only carries the primary key on UPDATE and DELETE.
alter table public.notifications replica identity full;
