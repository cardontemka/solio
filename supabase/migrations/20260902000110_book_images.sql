-- Book images. The bytes live in object storage; this table holds only
-- metadata plus the status that makes the upload safe.
--
-- Kept as a table rather than a jsonb array on book_copies (ADR-012) because
-- images need per-image moderation, an audit trail, and a `status` lifecycle
-- that lets a sweeper find objects whose upload never completed.

create domain public.image_status as text
  constraint image_status_values
  check (value in ('pending','ready','removed'));

create table public.book_images (
  id           uuid primary key default gen_random_uuid(),
  book_copy_id uuid not null references public.book_copies(id) on delete restrict,
  -- Server-generated key only. The user's filename never appears anywhere:
  -- not stored, not logged, not used in Content-Disposition. The regex means
  -- even a compromised app cannot register a traversal-shaped key.
  storage_key  text not null unique
                 check (storage_key ~ '^copies/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  sort_order   smallint not null default 0 check (sort_order between 0 and 7),
  status       public.image_status not null default 'pending',
  mime_type    text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size    int  not null check (byte_size between 1024 and 5242880),
  width        int  check (width  is null or width  between 200 and 8000),
  height       int  check (height is null or height between 200 and 8000),
  provider     text not null default 'local' check (provider in ('r2','local')),
  uploaded_by  uuid not null references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now()
);

-- sort_order 0 is the cover, so "two primaries" or "no primary" cannot occur.
create unique index book_images_copy_order_key
  on public.book_images (book_copy_id, sort_order) where status <> 'removed';
create index book_images_copy_idx
  on public.book_images (book_copy_id, sort_order) where status = 'ready';
-- Lets the sweeper find abandoned presigns cheaply.
create index book_images_pending_idx
  on public.book_images (created_at) where status = 'pending';

create or replace function private.book_images_enforce_count()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (select count(*) from public.book_images
       where book_copy_id = new.book_copy_id and status <> 'removed') > 8 then
    raise exception 'TOO_MANY_IMAGES' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger book_images_count_trg
  after insert or update on public.book_images
  deferrable initially deferred
  for each row execute function private.book_images_enforce_count();

-- ── Guard ─────────────────────────────────────────────────────────────────
-- Without this the owner could set status='ready' directly and skip the
-- server-side magic-number check — meaning arbitrary bytes uploaded to the
-- bucket would be served from the image CDN. (Review finding H4.)
create or replace function private.book_images_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMAGES_ARE_NOT_HARD_DELETED' using errcode = '42501',
      hint = 'Set status = ''removed'' instead.';
  end if;
  if not private.is_privileged_context() then
    if new.storage_key is distinct from old.storage_key
       or new.mime_type   is distinct from old.mime_type
       or new.byte_size   is distinct from old.byte_size
       or new.width       is distinct from old.width
       or new.height      is distinct from old.height
       or new.book_copy_id is distinct from old.book_copy_id
       or new.uploaded_by is distinct from old.uploaded_by
       or new.provider    is distinct from old.provider then
      raise exception 'IMAGE_METADATA_IS_SERVER_OWNED' using errcode = '42501';
    end if;
    -- The owner may reorder and may remove; only the server may publish.
    if new.status is distinct from old.status and new.status <> 'removed' then
      raise exception 'ONLY_SERVER_MAY_PUBLISH_IMAGE' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger book_images_guard_trg before update or delete on public.book_images
  for each row execute function private.book_images_guard();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.book_images enable row level security;
grant select, update on public.book_images to authenticated;
grant select on public.book_images to anon;
-- No INSERT grant: rows are created by the presign Route Handler through the
-- SECURITY DEFINER function below, which also enforces the per-copy limit.

create policy book_images_select_public on public.book_images
  for select to anon, authenticated
  using (status = 'ready' or private.owns_copy(book_copy_id) or private.is_staff());

create policy book_images_update_owner on public.book_images
  for update to authenticated
  using      (private.owns_copy(book_copy_id) or private.is_staff())
  with check (private.owns_copy(book_copy_id) or private.is_staff());

-- ── Upload intent ─────────────────────────────────────────────────────────
-- Re-reads ownership from the database rather than trusting the caller, and
-- returns the key the client must upload to. Nothing is publishable yet.
create or replace function public.create_image_upload_intent(
  p_copy_id   uuid,
  p_mime_type text,
  p_byte_size int,
  p_provider  text default 'local')
returns table (image_id uuid, storage_key text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_image_id uuid := gen_random_uuid();
  v_ext text;
  v_key text;
  v_count int;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.book_copies
                  where id = p_copy_id and owner_id = v_actor) then
    raise exception 'NOT_YOUR_COPY' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles
                  where id = v_actor and account_status = 'active') then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  -- Extension is derived from the MIME type, never from a filename.
  v_ext := case p_mime_type
             when 'image/jpeg' then 'jpg'
             when 'image/png'  then 'png'
             when 'image/webp' then 'webp'
             else null end;
  if v_ext is null then
    raise exception 'UNSUPPORTED_MIME_TYPE' using errcode = '23514';
  end if;

  select count(*) into v_count from public.book_images
   where book_copy_id = p_copy_id and status <> 'removed';
  if v_count >= 8 then
    raise exception 'TOO_MANY_IMAGES' using errcode = '23514';
  end if;

  v_key := 'copies/' || p_copy_id::text || '/' || v_image_id::text || '.' || v_ext;

  insert into public.book_images (id, book_copy_id, storage_key, sort_order,
                                  status, mime_type, byte_size, provider, uploaded_by)
  values (v_image_id, p_copy_id, v_key, v_count, 'pending',
          p_mime_type, p_byte_size, p_provider, v_actor);

  return query select v_image_id, v_key;
end $$;

-- Publishes an image after the server has verified the bytes.
create or replace function public.publish_image(
  p_image_id uuid,
  p_width    int,
  p_height   int,
  p_byte_size int)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.book_images i
      join public.book_copies c on c.id = i.book_copy_id
     where i.id = p_image_id and c.owner_id = v_actor and i.status = 'pending'
  ) then
    raise exception 'NOT_YOUR_PENDING_IMAGE' using errcode = '42501';
  end if;

  update public.book_images
     set status = 'ready', width = p_width, height = p_height, byte_size = p_byte_size
   where id = p_image_id;
end $$;

revoke all on function public.create_image_upload_intent(uuid,text,int,text) from public, anon;
revoke all on function public.publish_image(uuid,int,int,int) from public, anon;
grant execute on function public.create_image_upload_intent(uuid,text,int,text) to authenticated;
grant execute on function public.publish_image(uuid,int,int,int) to authenticated;
