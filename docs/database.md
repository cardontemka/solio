# Solio — Өгөгдлийн сангийн бүтэц

> Бүх table, багана, constraint, index, хайлтын бүтэц болон migration workflow.
> Холбоотой: [architecture.md](./architecture.md) · [security.md](./security.md) ·
> [transactions.md](./transactions.md) · [decisions.md](./decisions.md)

---

## 1. ERD

```
┌───────────────────────────────────────────────────────────────────────────┐
│ auth.users            ← Supabase Auth удирддаг, public schema-д БАЙХГҮЙ    │
│ email · phone · encrypted_password · confirmed_at                         │
│ PostgREST энэ schema-г ХЭЗЭЭ Ч харуулдаггүй                                │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ 1:1  id   ON DELETE CASCADE
                                │      (trigger: handle_new_user)
                                ▼
                   ┌────────────────────────┐        ┌──────────────────┐
                   │ profiles      НИЙТИЙН   │───1:*──│ user_roles       │
                   │ id (PK,FK)             │        │ user_id (PK)     │
                   │ username · display_name│        │ role    (PK)     │
                   │ avatar_key · bio · city│        │ granted_by       │
                   │ account_status         │        │ ЗӨВХӨН admin бичнэ│
                   │ created_at · updated_at│        └──────────────────┘
                   └────────────────────────┘
                     ▲        ▲         ▲         ▲            ▲
         created_by  │        │         │         │            │ reporter_id
                     │  owner_id /      │ user_id │ requester_id
                     │  custodian_id    │         │ responder_id
   ┌─────────────────┴──┐  ┌────────────┴───────┐ │      ┌─────┴──────────────┐
   │ books              │  │ book_copies        │ │      │ swaps              │
   │ id · title · author│1 │ id                 │ │      │ id                 │
   │ isbn · publisher   │──│ book_id      (FK)  │ │      │ requester_id       │
   │ language           │ *│ owner_id     (FK)  │ │      │ responder_id       │
   │ description        │  │ custodian_id (FK)  │ │      │ status             │
   │ published_at       │  │ condition          │ │      │ confirmed_by       │
   │ created_by         │  │ condition_note     │ │      │ message            │
   │ moderation_status  │  │ status             │ │      │ completed_at       │
   │ isbn_norm     (gen)│  │ moderation_status  │ │      │ closed_at          │
   │ title_norm    (gen)│  │ transfer_count     │ │      └────────────────────┘
   │ author_norm   (gen)│  │ created_at         │ │             │ 1
   │ search_vector (gen)│  │ updated_at         │ │             │
   └────────────────────┘  └────────────────────┘ │             │ *
      ▲                       ▲ 1        ▲        │       ┌─────┴────────────┐
      │ book_id               │          │        │       │ swap_items       │
      │                       │ *        │        │       │ swap_id     (PK) │
 ┌────┴──────────┐   ┌────────┴───────┐  │        │       │ book_copy_id(PK) │
 │ book_reviews  │   │ book_images    │  │        │       │ side             │
 │ id · book_id  │   │ id             │  │        │       └──────────────────┘
 │ user_id       │   │ book_copy_id   │  │        │             │
 │ rating 1..5   │   │ storage_key    │  │        │             │ swap_id
 │ body          │   │ sort_order     │  │        │             ▼
 │ moderation_st │   │ status         │  │   ┌────┴──────────────────────────┐
 │ UQ(user,book) │   │ width · height │  │   │ ownership_events   APPEND-ONLY│
 └───────────────┘   │ byte_size·mime │  │   │ id (bigint)                   │
                     └────────────────┘  └───│ book_copy_id                  │
                                             │ from_owner_id · to_owner_id   │
                                             │ event_type · swap_id          │
                                             │ actor_id · metadata           │
                                             │ occurred_at                   │
                                             │ UQ (swap_id, book_copy_id)    │
                                             └───────────────────────────────┘

┌──────────────────┐ ┌─────────────────┐ ┌──────────────┐ ┌─────────────────────┐
│ book_requests    │ │ notifications   │ │ reports      │ │ audit_logs          │
│ (= wishlist)     │ │ id · user_id    │ │ id           │ │ APPEND-ONLY         │
│ id · user_id     │ │ type            │ │ reporter_id  │ │ id · actor_id       │
│ book_id NULLABLE │ │ entity_type/id  │ │ entity_type  │ │ actor_role · action │
│ title·author·isbn│ │ payload         │ │ entity_id    │ │ entity_type/id      │
│ isbn_norm  (gen) │ │ read_at         │ │ reason       │ │ outcome             │
│ title_norm (gen) │ │ created_at      │ │ status       │ │ payload jsonb       │
│ status           │ │                 │ │ resolved_by  │ │ created_at          │
└──────────────────┘ └─────────────────┘ └──────────────┘ └─────────────────────┘
```

**Нийт 14 table:** `profiles`, `user_roles`, `books`, `book_copies`, `book_images`,
`book_reviews`, `book_requests`, `swaps`, `swap_items`, `ownership_events`, `notifications`,
`reports`, `audit_logs` — болон Supabase-ийн `auth.users`.

Brief §62-той харьцуулбал `wishlists` нь `book_requests`-д нэгтгэгдсэн, `profiles_private` нь
үүсгэгдээгүй, `user_roles` нэмэгдсэн. Үндэслэл: [architecture.md §10](./architecture.md).

---

## 2. Migration 0001 — суурь тохиргоо

```sql
-- supabase/migrations/0001_bootstrap.sql

-- Өргөтгөлүүд. extensions schema-д тавина (Supabase-ийн зөвлөмж).
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Дотоод туслах function-уудын schema. Клиент энд ХЭЗЭЭ Ч хүрэхгүй.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, anon;

-- Шинэ table автоматаар нээлттэй болохоос сэргийлнэ. GRANT-ыг табл бүрт
-- гараар, яг хэрэгтэй үйлдлээр нь өгнө.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
```

> **Чухал:** RLS policy болон GRANT нь **хоёр тусдаа шалгалт**. Policy зөвшөөрсөн ч GRANT байхгүй
> бол хандалт хаагдана. Table бүр дээр хоёуланг нь зориудаар тохируулна.

---

## 3. Migration 0002 — DOMAIN төрлүүд

Статусын утгуудыг `CREATE DOMAIN` ашиглан **нэг удаа** тодорхойлж, олон table-д дахин ашиглана.

```sql
-- supabase/migrations/0002_domains.sql

create domain public.book_condition as text
  constraint book_condition_values
  check (value in ('new','like_new','good','fair','poor'));

create domain public.copy_status as text
  constraint copy_status_values
  check (value in ('available','reserved','swapped','inactive'));

create domain public.swap_status as text
  constraint swap_status_values
  check (value in ('REQUESTED','ACCEPTED','CONFIRMED','COMPLETED','REJECTED','CANCELLED'));

create domain public.content_moderation_status as text
  constraint content_moderation_status_values
  check (value in ('active','hidden','removed'));

create domain public.account_status as text
  constraint account_status_values
  check (value in ('active','suspended','removed'));

create domain public.app_role as text
  constraint app_role_values
  check (value in ('user','moderator','admin'));

create domain public.image_status as text
  constraint image_status_values
  check (value in ('pending','ready','removed'));

create domain public.request_status as text
  constraint request_status_values
  check (value in ('open','fulfilled','cancelled'));

create domain public.report_status as text
  constraint report_status_values
  check (value in ('open','reviewing','resolved','dismissed'));

create domain public.ownership_event_type as text
  constraint ownership_event_type_values
  check (value in ('initial_registration','swap_transfer','admin_correction'));
```

### 3.1 Яагаад DOMAIN, native ENUM биш вэ

| Хувилбар | Шинэ утга нэмэх | Асуудал |
|---|---|---|
| `CREATE TYPE … AS ENUM` | `ALTER TYPE … ADD VALUE` | Transaction block дотор нэмсэн утгыг тухайн transaction дуустал **ашиглах боломжгүй**. Supabase CLI migration-уудыг transaction-д ажиллуулдаг тул энэ нь хоёр migration-ий бүжиг болно. Мөн `DROP VALUE` байхгүй — үсгийн алдаа мөнхөрнө. |
| `text` + table бүрийн `CHECK` | Table бүрийг тусад нь `ALTER` | Нэг утгын жагсаалт олон газар давхарддаг → зөрөх эрсдэлтэй |
| **`CREATE DOMAIN` + CHECK** ✅ | `ALTER DOMAIN … DROP CONSTRAINT` + `ADD CONSTRAINT` | Transaction дотор бүрэн ажиллана; тодорхойлолт нэг газар; олон table хуваалцана |

Brief §3.6 нь `copy_status`-д хожим 5 утга (`in_transit`, `at_partner_location`,
`custody_requested`, `custody_confirmed`, `lost`) нэмэгдэнэ гэж заасан. Ирээдүйн migration:

```sql
alter domain public.copy_status drop constraint copy_status_values;
alter domain public.copy_status add constraint copy_status_values
  check (value in ('available','reserved','swapped','inactive',
                   'in_transit','at_partner_location','custody_requested',
                   'custody_confirmed','lost'));
```

### 3.2 TypeScript талын нэг эх сурвалж

`supabase gen types typescript` нь DOMAIN-г `string` гэж гаргана. Тиймээс утгын жагсаалтыг
Zod дээр **нэг удаа** тодорхойлж, DAL-ийн хилээр өнгөрөх бүрд шалгана:

```ts
// src/features/books/schema.ts
export const COPY_STATUS = ['available','reserved','swapped','inactive'] as const
export const copyStatus = z.enum(COPY_STATUS)
export type CopyStatus = z.infer<typeof copyStatus>   // union, string биш
```

`supabase/tests/domains.test.sql` (pgTAP) нь DOMAIN-ийн утгын жагсаалт TS константтай тэнцүү
эсэхийг шалгана.

---

## 4. Migration 0003 — нормчлолын функцууд

```sql
-- supabase/migrations/0003_text_functions.sql

-- unaccent() нь анхдагчаар STABLE (dictionary хайлт хийдэг тул), харин generated
-- column нь IMMUTABLE функц шаарддаг. Тиймээс dictionary-г ЗААВАЛ тодорхой заана.
create or replace function public.solio_unaccent(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, p) $$;

-- Хайлт/тааруулалтад зориулсан нормчлол.
--   · жижиг үсэг рүү
--   · латин диакритик хасах
--   · монгол бичгийн түгээмэл орлуулалт: ё→е, й→и
--     (ө, ү-г ЗОРИУДААР хөндөхгүй — тэдгээр нь өөр авиа, орлуулбал утга алдагдана)
--   · зай/цэг таслалыг нэг зайд хураах
create or replace function public.solio_norm(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$
  select btrim(regexp_replace(
           translate(lower(public.solio_unaccent(coalesce(p,''))),
                     'ёй', 'еи'),
           '[^a-z0-9а-яөү]+', ' ', 'g'))
$$;

-- ISBN нормчлол: зураас/зай хасаж, X-ийг том үсгээр.
create or replace function public.solio_isbn_norm(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p,''), '[^0-9Xx]', '', 'g')), '')
$$;
```

> **Монгол хэлний тайлбар:** PostgreSQL-д монгол хэлний stemmer/dictionary байхгүй. Тиймээс
> `to_tsvector`-д `'simple'` тохиргоог ашиглана — үг таслах боловч үндэслэх (stemming) хийхгүй.
> Монгол хэлний нөхөх (agglutination) шинжийг хоёр механизм барина: (1) tsquery-ийн сүүлчийн
> үг дээрх `:*` prefix, (2) `pg_trgm`-ийн `word_similarity()`. Жишээ: `ном` гэсэн хайлт
> *Монголын ном*, *Номын сан*, *Номууд* гурвыг олох ёстой — `src/tests/unit/search.test.ts`-д
> заавал тест байна.

---

## 5. Table-уудын бүрэн DDL

### 5.1 `profiles` — нийтийн профайл

```sql
-- supabase/migrations/0010_profiles.sql
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  username       text not null check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name   text not null check (length(btrim(display_name)) between 1 and 60),
  avatar_key     text check (avatar_key is null or length(avatar_key) <= 200),
  bio            text check (bio is null or length(bio) <= 500),
  city           text check (city is null or length(city) <= 60),
  account_status public.account_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index profiles_username_key on public.profiles (lower(username));
```

| Багана | Тайлбар |
|---|---|
| `id` | `auth.users.id`-тай ижил. Business table бүр энд заана — `auth.users` клиентийн query-д хэзээ ч гарахгүй |
| `username` | Зөвхөн жижиг үсэг, тоо, доогуур зураас. URL-д ашиглагдана (`/u/{username}`) |
| `account_status` | `suspended` → нэвтэрч чадах ч бичих үйлдэл хаагдана. `removed` → админ устгасан |
| **email / phone** | **ЭНД БАЙХГҮЙ.** `auth.users`-д үлдэнэ. Үндэслэл: [architecture.md §10.2](./architecture.md) |

Шинэ хэрэглэгч бүртгүүлэхэд профайл автоматаар үүснэ:

```sql
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    -- email-ийн локал хэсгээс эхлэлийн username, мөргөлдвөл id-ийн эхний 8 тэмдэгт
    coalesce(
      nullif(regexp_replace(lower(split_part(new.email,'@',1)), '[^a-z0-9_]', '', 'g'), ''),
      'user'
    ) || substr(replace(new.id::text,'-',''), 1, 8),
    coalesce(new.raw_user_meta_data->>'display_name', 'Шинэ хэрэглэгч')
  );
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
```

### 5.2 `user_roles` — эрхийн хуваарилалт

```sql
-- supabase/migrations/0011_user_roles.sql
create table public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- authenticated role-д INSERT/UPDATE/DELETE grant ОГТ өгөхгүй.
grant select on public.user_roles to authenticated;
alter table public.user_roles enable row level security;
alter table public.user_roles force  row level security;
```

Эрх шалгах туслах функц. `SECURITY DEFINER` — policy дотроос дуудахад өөрөө RLS-д баригдвал
`42P17` (infinite recursion) алдаа гарна:

```sql
create or replace function private.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
     where user_id = (select auth.uid()) and role = p_role
  )
$$;

create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
     where user_id = (select auth.uid()) and role in ('moderator','admin')
  )
$$;

create or replace function private.is_active_account()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
     where id = (select auth.uid()) and account_status = 'active'
  )
$$;
```

> `auth.uid()`-г `(select auth.uid())` гэж боож бичсэнийг анхаар. Ингэснээр PostgreSQL үүнийг мөр
> бүрд дахин тооцохгүй, нэг удаа тооцоод `InitPlan` болгож кэшлэнэ. Олон мянган мөртэй table дээр
> энэ нь хэдэн дахин хурдны зөрүү гаргадаг.

### 5.3 `books` — хийсвэр бүтээл

```sql
-- supabase/migrations/0020_books.sql
create table public.books (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(btrim(title)) between 1 and 300),
  author            text check (author      is null or length(author)      <= 200),
  isbn              text check (isbn        is null or length(isbn)         <= 32),
  publisher         text check (publisher   is null or length(publisher)   <= 200),
  language          text check (language    is null or language ~ '^[a-z]{2}(-[A-Za-z]{2,8})*$'),
  description       text check (description is null or length(description) <= 8000),
  published_at      date check (published_at is null
                                or published_at <= (now() + interval '1 year')::date),
  created_by        uuid references public.profiles(id) on delete set null,
  moderation_status public.content_moderation_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  isbn_norm   text generated always as (public.solio_isbn_norm(isbn)) stored,
  title_norm  text generated always as (public.solio_norm(title))     stored,
  author_norm text generated always as (public.solio_norm(author))    stored,

  search_vector tsvector generated always as (
       setweight(to_tsvector('simple', public.solio_norm(title)),  'A')
    || setweight(to_tsvector('simple', public.solio_norm(coalesce(author,''))), 'B')
    || setweight(to_tsvector('simple',
         coalesce(public.solio_isbn_norm(isbn),'') || ' ' ||
         public.solio_norm(coalesce(publisher,''))), 'C')
    || setweight(to_tsvector('simple', public.solio_norm(coalesce(description,''))), 'D')
  ) stored
);

-- Нэг ISBN нэг л ном. NULL ISBN-тэй ном хэдэн ч байж болно.
create unique index books_isbn_norm_key
  on public.books (isbn_norm) where isbn_norm is not null;
```

`isbn` заавал биш (brief §30). ISBN-гүй ном гараар бүртгэгдэнэ.

### 5.4 `book_copies` — физик хуулбар

```sql
-- supabase/migrations/0030_book_copies.sql
create table public.book_copies (
  id                uuid primary key default gen_random_uuid(),
  book_id           uuid not null references public.books(id)    on delete restrict,
  owner_id          uuid not null references public.profiles(id) on delete restrict,
  custodian_id      uuid not null references public.profiles(id) on delete restrict,
  condition         public.book_condition not null,
  condition_note    text check (condition_note is null or length(condition_note) <= 1000),
  status            public.copy_status not null default 'available',
  moderation_status public.content_moderation_status not null default 'active',
  transfer_count    int not null default 0 check (transfer_count >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- MVP-ийн инвариант: эзэмшил ба биет хадгалалт давхцана.
  -- Cafe custody нэмэх үед ЭНЭ constraint-ыг л хасна (§future-expansion).
  constraint book_copies_custody_follows_ownership check (custodian_id = owner_id)
);
```

`owner_id` дээр `on delete restrict` — хэрэглэгчийг устгахад номын түүх алдагдахгүй.
Данс устгах үед `profiles.account_status = 'removed'` болгож зөөлөн устгана.

### 5.5 `book_images` — номын зураг

```sql
-- supabase/migrations/0031_book_images.sql
create table public.book_images (
  id           uuid primary key default gen_random_uuid(),
  book_copy_id uuid not null references public.book_copies(id) on delete restrict,
  storage_key  text not null unique
                 check (storage_key ~ '^copies/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  sort_order   smallint not null default 0 check (sort_order between 0 and 7),
  status       public.image_status not null default 'pending',
  mime_type    text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size    int  not null check (byte_size between 1024 and 5242880),
  width        int  check (width  is null or width  between 200 and 8000),
  height       int  check (height is null or height between 200 and 8000),
  uploaded_by  uuid not null references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now()
);

-- Нэг хуулбар дээр нэг sort_order давхардахгүй (устгасныг тооцохгүй)
create unique index book_images_copy_order_key
  on public.book_images (book_copy_id, sort_order) where status <> 'removed';

-- sort_order = 0 нь үндсэн зураг. Тиймээс "үндсэн зураг" гэдэг тусдаа багана хэрэггүй —
-- хоёр үндсэн зураг, эсвэл үндсэн зураггүй байх нөхцөл бүтцээрээ үүсэхгүй.
create index book_images_copy_idx
  on public.book_images (book_copy_id, sort_order) where status = 'ready';
```

Нэг хуулбарт **хамгийн ихдээ 8 зураг** (`sort_order` 0..7 + trigger):

```sql
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
```

`status` урсгал: `pending` (presign олгосон) → `ready` (сервер байтыг шалгасан) → `removed`
(зөөлөн устгасан). Дэлгэрэнгүй: [security.md §7](./security.md).

### 5.6 `book_reviews`

```sql
-- supabase/migrations/0040_book_reviews.sql
create table public.book_reviews (
  id                uuid primary key default gen_random_uuid(),
  book_id           uuid not null references public.books(id)    on delete restrict,
  user_id           uuid not null references public.profiles(id) on delete restrict,
  rating            smallint not null check (rating between 1 and 5),
  body              text check (body is null or length(body) <= 4000),
  moderation_status public.content_moderation_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Brief §12: нэг хэрэглэгч нэг номд давхар review бичихгүй.
  constraint book_reviews_one_per_user_book unique (user_id, book_id)
);
```

`unique (user_id, book_id)` нь **феатур өөрөө** — давхар review-г application код биш DB таслана.
Дахин илгээхэд `23505` буцаж, UI "өмнөх сэтгэгдлээ засах уу?" гэж санал болгоно.

> **Review хийхэд урьдчилсан нөхцөл тавих уу?** MVP-д **үгүй** — нэвтэрсэн, идэвхтэй данстай
> хэн ч review бичиж болно. Шалтгаан: review нь **номын чанарын** үнэлгээ болохоос гүйлгээний
> үнэлгээ биш. Хэрэглэгч уншсан номоо солилцоод дараа нь үнэлэх нь хэвийн, мөн энд эзэмшиж
> байгаагүй ч уншсан хүн байж болно. Харин **хэрэглэгчийн найдвартай байдлын үнэлгээ**
> (user reliability rating) нь өөр ойлголт бөгөөд тэр нь заавал `COMPLETED` swap-ийн дараа л
> өгөгдөнө — түүнийг MVP-д хийхгүй, гэхдээ `book_reviews`-тэй хольж загварчлаагүй.
> ADR-012: [decisions.md](./decisions.md).

### 5.7 `book_requests` — wishlist + байхгүй номын хүсэлт

```sql
-- supabase/migrations/0041_book_requests.sql
create table public.book_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete restrict,
  book_id      uuid references public.books(id) on delete restrict,   -- NULL = чөлөөт хүсэлт
  title        text check (title  is null or length(btrim(title)) between 1 and 300),
  author       text check (author is null or length(author) <= 200),
  isbn         text check (isbn   is null or length(isbn)   <= 32),
  note         text check (note   is null or length(note)   <= 500),
  status       public.request_status not null default 'open',
  matched_book_id uuid references public.books(id) on delete set null,
  created_at   timestamptz not null default now(),
  fulfilled_at timestamptz,

  isbn_norm  text generated always as (public.solio_isbn_norm(isbn)) stored,
  title_norm text generated always as (public.solio_norm(coalesce(title,''))) stored,

  constraint book_requests_target check (book_id is not null or title is not null),
  constraint book_requests_fulfilled_stamp
    check ((status = 'fulfilled') = (fulfilled_at is not null))
);

-- Нэг ном дээр нэг хэрэглэгч нэг л нээлттэй хүсэлт
create unique index book_requests_no_dup
  on public.book_requests (user_id, book_id)
  where book_id is not null and status = 'open';
```

### 5.8 `swaps` ба `swap_items`

```sql
-- supabase/migrations/0050_swaps.sql
create table public.swaps (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete restrict,
  responder_id uuid not null references public.profiles(id) on delete restrict,
  status       public.swap_status not null default 'REQUESTED',
  confirmed_by uuid references public.profiles(id) on delete restrict,
  message      text check (message is null or length(message) <= 2000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  closed_at    timestamptz,

  constraint swaps_distinct_parties check (requester_id <> responder_id),
  constraint swaps_confirmed_by_is_party
    check (confirmed_by is null or confirmed_by in (requester_id, responder_id)),
  constraint swaps_completed_stamp
    check ((status = 'COMPLETED') = (completed_at is not null)),
  constraint swaps_closed_stamp
    check ((status in ('COMPLETED','REJECTED','CANCELLED')) = (closed_at is not null))
);

create table public.swap_items (
  swap_id      uuid not null references public.swaps(id)       on delete restrict,
  book_copy_id uuid not null references public.book_copies(id) on delete restrict,
  side         text not null check (side in ('offered','requested')),
  primary key (swap_id, book_copy_id)
);
```

Database нь **N ↔ N** солилцоог дэмжинэ (brief §13), гэхдээ MVP-ийн UI болон
`public.request_swap(p_offered_copy_id uuid, p_requested_copy_id uuid, …)` RPC-ийн гарын үсэг нь
**1 ↔ 1**. N↔N рүү шилжихэд `uuid[]` авдаг шинэ function бичихэд хангалттай — **schema өөрчлөгдөхгүй**.

### 5.9 `ownership_events` — өөрчлөгдөшгүй өмчлөлийн дэвтэр

```sql
-- supabase/migrations/0051_ownership_events.sql
create table public.ownership_events (
  id            bigint generated always as identity primary key,
  book_copy_id  uuid not null references public.book_copies(id) on delete restrict,
  from_owner_id uuid          references public.profiles(id)    on delete restrict,
  to_owner_id   uuid not null references public.profiles(id)    on delete restrict,
  event_type    public.ownership_event_type not null,
  swap_id       uuid references public.swaps(id) on delete restrict,
  actor_id      uuid references public.profiles(id) on delete restrict,
  metadata      jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now(),

  constraint oe_no_self_transfer
    check (from_owner_id is distinct from to_owner_id),
  constraint oe_initial_has_no_source
    check ((event_type = 'initial_registration') = (from_owner_id is null)),
  constraint oe_swap_transfer_has_swap
    check ((event_type = 'swap_transfer') = (swap_id is not null))
);

-- ★ Схемийн ХАМГИЙН ЧУХАЛ index.
-- "Нэг swap дээр нэг хуулбар зөвхөн НЭГ УДАА шилжинэ" гэдгийг физикээр баталгаажуулна.
-- Давхар дуудлага, retry, replay бүгд 23505 өгнө — өгөгдөл эвдрэхгүй.
create unique index ownership_events_one_per_swap_copy
  on public.ownership_events (swap_id, book_copy_id) where swap_id is not null;
```

### 5.10 `notifications`, `reports`, `audit_logs`

```sql
-- supabase/migrations/0060_notifications_reports_audit.sql
create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in (
                'swap_requested','swap_accepted','swap_rejected','swap_cancelled',
                'swap_confirmed','swap_completed','wishlist_match',
                'review_received','report_resolved','moderation_action')),
  entity_type text not null check (entity_type in
                ('swap','book','book_copy','review','report','profile')),
  entity_id   uuid not null,
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Нэг ном дээр нэг хэрэглэгчид wishlist мэдэгдэл нэг л удаа
create unique index notifications_wishlist_once
  on public.notifications (user_id, entity_id) where type = 'wishlist_match';

create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references public.profiles(id) on delete restrict,
  entity_type     text not null check (entity_type in
                    ('book','book_copy','review','profile','swap')),
  entity_id       uuid not null,
  reason          text not null check (reason in
                    ('spam','inappropriate','counterfeit','wrong_metadata',
                     'harassment','other')),
  detail          text check (detail is null or length(detail) <= 2000),
  status          public.report_status not null default 'open',
  resolution_note text check (resolution_note is null or length(resolution_note) <= 2000),
  resolved_by     uuid references public.profiles(id) on delete restrict,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint reports_resolved_stamp
    check ((status in ('resolved','dismissed')) = (resolved_at is not null))
);

-- Нэг хүн нэг зүйл дээр нэг л нээлттэй гомдол → спам хаана
create unique index reports_one_open_per_target
  on public.reports (reporter_id, entity_type, entity_id)
  where status in ('open','reviewing');

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_role  public.app_role,
  action      text not null check (length(action) between 3 and 64),
  entity_type text not null,
  entity_id   text not null,
  outcome     text not null default 'success' check (outcome in ('success','denied')),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
```

> `audit_logs.outcome = 'denied'` нь **зориудаар** байгаа. Зөвхөн амжилттай үйлдлийг бүртгэдэг лог
> нь "хэн нэгэн оролдсон уу?" гэсэн — аливаа халдлагын мөрдөн байцаалтын **эхний** асуултад
> хариулж чадахгүй.
>
> Audit log-д **email, утас, нууц үг, token хэзээ ч бичигдэхгүй** (brief §16). Зөвхөн id,
> үйлдлийн нэр, төлөвийн өмнөх/дараах утга.

---

## 6. Өөрчлөгдөшгүй байдлыг албадах

`ownership_events` болон `audit_logs` нь **зөвхөн нэмэгддэг** (append-only). Гурван давхарга:

```sql
-- supabase/migrations/0070_immutability.sql
create or replace function private.solio_deny_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'TABLE_IS_APPEND_ONLY: %', tg_table_name using errcode = '42501';
end $$;

-- 1. Trigger — service_role-ийг ч зогсооно (trigger нь BYPASSRLS role дээр ч ажиллана)
create trigger ownership_events_immutable_trg
  before update or delete on public.ownership_events
  for each row execute function private.solio_deny_mutation();

create trigger ownership_events_no_truncate_trg
  before truncate on public.ownership_events
  for each statement execute function private.solio_deny_mutation();

create trigger audit_logs_immutable_trg
  before update or delete on public.audit_logs
  for each row execute function private.solio_deny_mutation();

create trigger audit_logs_no_truncate_trg
  before truncate on public.audit_logs
  for each statement execute function private.solio_deny_mutation();

-- 2. GRANT — UPDATE/DELETE эрх огт өгөхгүй
grant select on public.ownership_events to authenticated;
grant select on public.audit_logs      to authenticated;

-- 3. RLS — UPDATE/DELETE policy огт байхгүй (policy байхгүй = зөвшөөрөл байхгүй)
alter table public.ownership_events enable row level security;
alter table public.ownership_events force  row level security;
alter table public.audit_logs       enable row level security;
alter table public.audit_logs       force  row level security;
```

`FORCE ROW LEVEL SECURITY` нь table-ийн эзэмшигчид (`postgres`) ч RLS үйлчлэхийг заана.

**Гурван давхаргын хуваарилалт:**

| Давхарга | Юуг зогсоох | Юуг зогсоохгүй |
|---|---|---|
| RLS policy байхгүй | `authenticated` role-ийн бүх бичилт | `service_role` (BYPASSRLS) |
| GRANT байхгүй | Эрхгүй үйлдлийн оролдлого | `postgres` эзэмшигч |
| **Trigger** | **Бүх role, `service_role` ба `postgres` хүртэл** | `alter table … disable trigger` (superuser) |

---

## 7. Хайлтын бүтэц

### 7.1 Index

```sql
-- supabase/migrations/0080_search.sql
create index books_search_vector_idx on public.books using gin (search_vector);
create index books_title_trgm_idx    on public.books using gin (title_norm  extensions.gin_trgm_ops);
create index books_author_trgm_idx   on public.books using gin (author_norm extensions.gin_trgm_ops);
```

### 7.2 Эрэмбэлсэн хайлтын query

FTS (яг таарах, үг таслах) болон trigram (үсгийн алдаа, хэсэгчилсэн таарах) **хоёуланг** нэг
оноонд нэгтгэнэ:

```sql
create function public.search_books(
  p_query  text,
  p_limit  int default 20,
  p_offset int default 0)
returns table (
  id uuid, title text, author text, isbn text,
  available_copies bigint, score real)
language sql stable security invoker set search_path = ''
as $$
  with q as (
    select public.solio_norm(p_query)      as norm,
           public.solio_isbn_norm(p_query) as isbn_norm,
           -- үг бүр дээр prefix тавьж монгол нөхөлтийг (агглютинаци) барина
           (select string_agg(w || ':*', ' & ')
              from unnest(string_to_array(public.solio_norm(p_query), ' ')) w
             where w <> '') as tsq
  ),
  scored as (
    select b.id, b.title, b.author, b.isbn, b.book_created_at,
           b.available_copies, b.raw_score::real as score
      from (
        select b.id, b.title, b.author, b.isbn,
               b.created_at as book_created_at,
               (select count(*) from public.book_copies c
                 where c.book_id = b.id and c.status = 'available'
                   and c.moderation_status = 'active') as available_copies,
               -- ISBN яг таарвал бусад бүх дохиог давна
               case when q.isbn_norm is not null and b.isbn_norm = q.isbn_norm
                    then 1.0 else 0 end
             + 0.6 * ts_rank_cd('{0.1,0.25,0.5,1.0}', b.search_vector,
                                to_tsquery('simple', q.tsq), 32)
             + 0.3 * extensions.word_similarity(q.norm, b.title_norm)
             + 0.1 * extensions.word_similarity(q.norm, coalesce(b.author_norm,''))
               as raw_score
          from public.books b, q
         where b.moderation_status = 'active'
           and q.norm <> ''
           and (   b.search_vector @@ to_tsquery('simple', q.tsq)
                -- ⚠ search_path = '' тул trigram операторыг ЗААВАЛ schema-гаар
                --   тодотгоно. `q.norm <% b.title_norm` гэж бичвэл
                --   "operator does not exist: text <% text" алдаа өгнө.
                or q.norm operator(extensions.<%) b.title_norm
                or q.norm operator(extensions.<%) coalesce(b.author_norm,'')
                or (q.isbn_norm is not null and b.isbn_norm = q.isbn_norm))
      ) b
  )
  select s.id, s.title, s.author, s.isbn, s.available_copies, s.score
    from scored s
   where s.score >= 0.10               -- чимээ шуугианы шүүлтүүр
   order by s.score desc, s.book_created_at desc, s.id desc
   limit  least(greatest(coalesce(p_limit, 20), 1), 50)
  offset least(greatest(coalesce(p_offset, 0), 0), 200);   -- 10 хуудсаар таслана
$$;

revoke all     on function public.search_books(text,int,int) from public;
grant  execute on function public.search_books(text,int,int) to anon, authenticated;
```

> **Энэ функц локал PostgreSQL 17 дээр бодитоор ажиллуулж шалгагдсан.** Хэмжсэн үр дүн:
>
> | Хайлт | Үр дүн | Оноо |
> |---|---|---|
> | `ном` | *Ном унших урлаг* | 0.6143 |
> | | *Номын сан ба уншлагын соёл* | 0.5393 |
> | `нууц товчоо` | *Монголын нууц товчоо* | 0.6167 |
> | `монголын` | *Монголын нууц товчоо* | 0.6143 |
> | `hobit` (үсгийн алдаа) | *The Hobbit* | 0.1875 |
> | `978-0-261-10221-7` | *The Hobbit* | 1.0000 |
> | `зззззз` | (хоосон) | — |
>
> `EXPLAIN` нь `books_search_vector_idx` (GIN), `books_title_trgm_idx` (GIN trgm) болон
> `books_isbn_norm_key` гурвыг planner ашиглаж байгааг баталсан.

**Загварын тэмдэглэл:**

- **`ts_rank_cd`, `ts_rank` биш.** `ts_rank` нь үгийн давтамжаар эрэмбэлдэг — 4 үгтэй гарчигт
  утгагүй. `ts_rank_cd` нь *cover density* буюу таарсан үгс хэр ойрхон байгааг хардаг.
- **Жингийн массив `{D,C,B,A}` = `{0.1,0.25,0.5,1.0}`** — гарчиг хамгийн чухал, тайлбар хамгийн бага.
- **Нормчлол `32`** нь оноог 0..1 болгоно — `word_similarity` ч мөн 0..1 тул нэмэхэд зохимжтой.
- **`ts_headline` ашиглахгүй.** PostgreSQL-ийн баримт бичиг түүний гаралт нь "веб дээр шууд
  оруулахад аюулгүй гэсэн баталгаагүй" гэж хэлдэг бөгөөд `title` нь хэрэглэгчийн оруулсан текст.
  Тодруулгыг клиент талд энгийн текст дээр хийнэ.
- **`OFFSET` 200-аар таслав.** Хайлт нь тооцоолсон оноогоор эрэмбэлэгддэг тул keyset pagination
  боломжгүй. 10 хуудаснаас цааш "хайлтаа нарийсгана уу" гэж заана.

### 7.3 Interface-ийн ард нуух

```ts
// src/features/search/ports.ts
export interface BookSearchIndex {
  search(query: SearchQuery): Promise<SearchResult>
  onBookUpserted(bookId: string): Promise<void>   // Postgres-д no-op
  onBookRemoved(bookId: string): Promise<void>
}
// src/features/search/index.ts — бусад код ЗӨВХӨН үүнийг импортолно
export const searchIndex: BookSearchIndex = new PostgresBookSearchIndex()
```

---

## 8. Feed-ийн pagination — keyset

```sql
create or replace function public.books_feed(
  p_limit             int default 20,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid default null)
returns table (id uuid, title text, author text, created_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select b.id, b.title, b.author, b.created_at
    from public.books b
   where b.moderation_status = 'active'
     and (p_cursor_created_at is null
          -- МӨРИЙН УТГЫН харьцуулалт: PostgreSQL үүнийг НЭГ index range scan болгоно.
          -- "a < x or (a = x and b < y)" гэж бичвэл тэр төлөвлөгөө гарахгүй.
          or (b.created_at, b.id) < (p_cursor_created_at, p_cursor_id))
   order by b.created_at desc, b.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 48) + 1;   -- +1 нь has_more хариулна
$$;
```

`OFFSET` нь feed-д **буруу**: (1) өртөг нь O(offset), (2) шинэ мөр яг эрэмбийн **дээд талд**
ордог тул хуудас хооронд мөр давхардах эсвэл алгасах болно. `created_at` дангаар давхцаж болох тул
`id` нь салгагч. Нийт тоог `count(*)`-аар хэзээ ч авахгүй — `limit n+1` нь `has_more`-г хариулна.

---

## 9. Index-ийн төлөвлөгөө

| Index | Table | Ямар query-г үйлчилнэ |
|---|---|---|
| `profiles_username_key` (unique) | profiles | `/u/{username}` профайл хуудас |
| `books_isbn_norm_key` (unique, partial) | books | ISBN-ээр давхардал шалгах, wishlist тааруулах |
| `books_search_vector_idx` (GIN) | books | Бүтэн текст хайлт |
| `books_title_trgm_idx` (GIN trgm) | books | Үсгийн алдаатай хайлт, wishlist fuzzy тааруулалт |
| `books_author_trgm_idx` (GIN trgm) | books | Зохиогчоор хайх |
| `books_feed_keyset` = `(moderation_status, created_at desc, id desc)` | books | Нүүр хуудасны "Шинээр нэмэгдсэн" |
| `book_copies_owner_idx` = `(owner_id, status)` | book_copies | "Миний номнууд", статусаар шүүх |
| `book_copies_book_idx` = `(book_id, status)` where `status='available'` | book_copies | Номын дэлгэрэнгүй дээрх боломжит хуулбарууд |
| `book_images_copy_idx` = `(book_copy_id, sort_order)` where `status='ready'` | book_images | Хуулбарын зургийг эрэмбээр татах |
| `book_reviews_book_idx` = `(book_id, created_at desc)` | book_reviews | Номын сэтгэгдлийн жагсаалт |
| `book_reviews_one_per_user_book` (unique) | book_reviews | Давхар review хаах |
| `book_requests_user_idx` = `(user_id, status)` | book_requests | "Миний хүсэлтүүд" |
| `book_requests_isbn_idx` = `(isbn_norm)` where `status='open'` | book_requests | Шинэ ном нэмэгдэхэд тааруулах |
| `swaps_requester_idx` = `(requester_id, status, created_at desc)` | swaps | "Миний илгээсэн хүсэлтүүд" |
| `swaps_responder_idx` = `(responder_id, status, created_at desc)` | swaps | "Надад ирсэн хүсэлтүүд" |
| `swap_items` PK `(swap_id, book_copy_id)` | swap_items | Swap-ийн зүйлсийг татах |
| `swap_items_copy_idx` = `(book_copy_id)` | swap_items | "Энэ хуулбар нээлттэй swap-д байна уу?" |
| `ownership_events_copy_idx` = `(book_copy_id, id)` | ownership_events | Өмчлөлийн гинжийг сэргээх |
| `ownership_events_one_per_swap_copy` (unique, partial) | ownership_events | **Давхар шилжүүлгээс хамгаалах** |
| `notifications_user_idx` = `(user_id, created_at desc)` where `read_at is null` | notifications | Уншаагүй мэдэгдлийн тоолуур |
| `reports_status_idx` = `(status, created_at)` | reports | Модераторын дараалал |
| `audit_logs_entity_idx` = `(entity_type, entity_id, created_at desc)` | audit_logs | Админ дээрх нэг зүйлийн түүх |

### 9.1 ЗОРИУДААР үүсгээгүй index

| Үүсгээгүй index | Яагаад |
|---|---|
| `books(title)` B-tree | Трграм GIN нь prefix болон fuzzy хоёуланг барина; B-tree зөвхөн prefix. Илүүдэл. |
| `books(author)`, `books(publisher)` B-tree | `search_vector`-т аль хэдийн жинтэйгээр орсон. |
| `book_copies(status)` дангаар | Selectivity бага (ихэнх нь `available`). `(owner_id, status)` composite хангалттай. |
| `audit_logs(actor_id)` | Админ ихэвчлэн entity-ээр хайдаг. Хэрэглээ гарвал нэмнэ. |
| `notifications(type)` | Selectivity бага, хэрэглээ нь үргэлж `user_id`-тай хамт. |

> Илүүдэл index бүр бичилтийг удаашруулж, дискний зай иддэг. Query pattern гарч ирэхээс өмнө
> index үүсгэхгүй.

---

## 10. Migration workflow

### 10.1 Ажлын урсгал

```
   ЛОКАЛ (Docker)                                CLOUD (production)
   ─────────────────                             ────────────────────
   supabase start
        │
        ├─ supabase migration new add_books
        │     → supabase/migrations/20260902...._add_books.sql
        │
        ├─ SQL бичих
        │
        ├─ supabase db reset          ← бүх migration + seed-ийг ЭХНЭЭС нь ажиллуулна
        │     (энэ нь migration-ийг бүрэн шалгах цорын ганц зам)
        │
        ├─ supabase test db           ← pgTAP тестүүд
        │
        ├─ npm run test               ← unit + integration
        │
        ├─ git add supabase/migrations/… && git commit
        │
        ├─ git push  →  PR  →  main
        │                        │
        │                        ▼
        └──────────────  supabase db push  ──────────►  production schema
```

### 10.2 Командууд

| Команд | Тайлбар |
|---|---|
| `supabase start` | Локал stack асаах (Docker) |
| `supabase stop` | Унтраах |
| `supabase status` | Төлөв + локал key-үүд |
| `supabase migration new <нэр>` | Хоосон migration файл үүсгэх |
| `supabase db reset` | Локал DB-г устгаж, бүх migration + `seed.sql`-ийг дахин ажиллуулах |
| `supabase db diff -f <нэр>` | Studio-д гараар хийсэн өөрчлөлтийг migration болгож гаргах |
| `supabase gen types typescript --local > src/types/database.ts` | TS төрөл үүсгэх |
| `supabase link --project-ref <ref>` | Repo-г cloud project-той холбох |
| `supabase db push` | Migration-уудыг cloud руу буулгах |
| `supabase test db` | pgTAP тест ажиллуулах |

### 10.3 Дүрмүүд

1. **Production schema-г Studio дээр гараар ХЭЗЭЭ Ч засахгүй.** Хэрэв яаралтай засвар хийсэн бол
   `supabase db diff -f hotfix_<нэр>` гэж migration болгож гаргаад заавал commit хийнэ.
2. **Migration бүр git-д commit хийгдэнэ.** Commit хийгдээгүй schema өөрчлөлт байхгүй.
3. **Migration файл нэг удаа commit хийгдсэний дараа ХЭЗЭЭ Ч засагдахгүй.** Алдаа гарвал шинэ
   migration бичиж засна (forward-only).
4. **Migration бүр `supabase db reset` дээр цэвэр ажиллах ёстой.** Өмнөх төлвөөс хамааралгүй.
5. Файлын нэр: `<timestamp>_<snake_case_тайлбар>.sql` — CLI автоматаар үүсгэнэ.

---

## 11. Seed data

`supabase/seed.sql` нь **зөвхөн локал/development**-д ажиллана. `supabase db push` нь seed-ийг
production руу **хэзээ ч илгээхгүй**.

```
Seed-д багтах зүйлс:
  · 6 demo хэрэглэгч (alice, bolor, ganbat, dulmaa, erdene, admin_demo)
  · 20 ном (монгол + англи гарчигтай, хайлтын тестэд зориулж)
  · 35 book_copy — янз бүрийн condition, status
  · 12 review
  · 8 book_request (зарим нь wishlist, зарим нь чөлөөт текст)
  · 5 swap — тус бүр өөр төлөвт (REQUESTED / ACCEPTED / CONFIRMED / COMPLETED / REJECTED)
  · COMPLETED swap-д харгалзах ownership_events гинж
```

**Production-оос ялгах:**

- Demo хэрэглэгчийн email бүр `@example.invalid` домэйнтэй — энэ TLD нь RFC 2606-аар
  бүртгэгдэхгүй тул production-д санамсаргүй үүсэх боломжгүй.
- Demo profile бүрийн `bio` нь `[DEMO]` гэж эхэлнэ.
- `seed.sql` эхлэхдээ хамгаалалт тавина:

```sql
do $$
begin
  if current_setting('app.environment', true) = 'production' then
    raise exception 'SEED_DATA_MUST_NEVER_RUN_IN_PRODUCTION';
  end if;
end $$;
```

---

## 12. Өмчлөлийн гинжийг сэргээх

```sql
select oe.occurred_at,
       fp.display_name as from_owner,
       tp.display_name as to_owner,
       oe.event_type, oe.swap_id
  from public.ownership_events oe
  left join public.profiles fp on fp.id = oe.from_owner_id
  join      public.profiles tp on tp.id = oe.to_owner_id
 where oe.book_copy_id = $1
 order by oe.id asc;          -- index: ownership_events_copy_idx
```

Үр дүн:

```
occurred_at           from_owner   to_owner   event_type
────────────────────  ───────────  ─────────  ─────────────────────
2026-03-01 10:22:04   (NULL)       Алтан      initial_registration
2026-04-14 18:05:51   Алтан        Болд       swap_transfer
2026-06-02 09:41:13   Болд         Цэцэг      swap_transfer
2026-08-19 15:30:00   Цэцэг        Дорж       swap_transfer
```

`id` нь монотон өсдөг тул нэг transaction дотор (`now()` тогтмол) хийгдсэн хоёр шилжүүлгийг ч
зөв эрэмбэлнэ.

### 12.1 Бүрэн бүтэн байдлын хяналт

Дараах query **үргэлж хоосон** буцаах ёстой. CI дээр seed хийсэн DB-д, мөн админ панел дээрх
эрүүл мэндийн шалгалтад ажиллана:

```sql
select bc.id, bc.owner_id, last.to_owner_id
  from public.book_copies bc
  join lateral (
    select to_owner_id from public.ownership_events
     where book_copy_id = bc.id order by id desc limit 1
  ) last on true
 where bc.owner_id <> last.to_owner_id;
```

Мөр буцаавал `book_copies.owner_id` болон дэвтрийн хамгийн сүүлийн бичлэг зөрсөн гэсэн үг —
энэ нь **өгөгдлийн эвдрэл** бөгөөд яаралтай шинжилгээ шаардана.
