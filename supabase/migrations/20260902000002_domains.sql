-- Status value lists, defined once and shared across tables.
-- DOMAIN (not native ENUM) so values can be added inside a transaction:
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it.

create domain public.book_condition as text
  constraint book_condition_values
  check (value in ('new','like_new','good','fair','poor'));

create domain public.copy_status as text
  constraint copy_status_values
  check (value in ('available','reserved','swapped','inactive'));

create domain public.content_moderation_status as text
  constraint content_moderation_status_values
  check (value in ('active','hidden','removed'));

create domain public.account_status as text
  constraint account_status_values
  check (value in ('active','suspended','removed'));

create domain public.app_role as text
  constraint app_role_values
  check (value in ('user','moderator','admin'));

create domain public.ownership_event_type as text
  constraint ownership_event_type_values
  check (value in ('initial_registration','swap_transfer','admin_correction'));
