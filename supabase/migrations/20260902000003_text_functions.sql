-- Normalisation helpers used by generated columns, so they must be IMMUTABLE.
-- unaccent() is STABLE by default; naming the dictionary explicitly makes the
-- wrapper safe to mark IMMUTABLE.

create or replace function public.solio_unaccent(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, p) $$;

-- lower + de-accent + Mongolian ё→е / й→и folding + punctuation squash.
-- ө and ү are deliberately preserved: they are distinct vowels, not variants.
create or replace function public.solio_norm(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$
  select btrim(regexp_replace(
           translate(lower(public.solio_unaccent(coalesce(p,''))), 'ёй', 'еи'),
           '[^a-z0-9а-яөү]+', ' ', 'g'))
$$;

create or replace function public.solio_isbn_norm(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$ select nullif(upper(regexp_replace(coalesce(p,''), '[^0-9Xx]', '', 'g')), '') $$;
