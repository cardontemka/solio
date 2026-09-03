-- comments_guard was attached to INSERT as well as UPDATE and DELETE. On an
-- insert `old` is NULL, so `new.user_id is distinct from old.user_id` is true
-- and every comment was rejected with COMMENT_IMMUTABLE_FIELD — the guard
-- blocked the thing it was meant to protect.
--
-- The immutability checks only mean anything against a previous row, so the
-- trigger now fires on UPDATE and DELETE, matching every other guard in the
-- schema. Insert-time rules are already covered: the column constraints reject
-- an empty body or a missing parent, and comments_insert_own rejects writing as
-- somebody else.

drop trigger comments_guard_trg on public.comments;

create trigger comments_guard_trg
  before update or delete on public.comments
  for each row execute function private.comments_guard();
