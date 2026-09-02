# Solio — Ирээдүйн өргөтгөл

> MVP-д хийхгүй боловч архитектур нь бэлтгэсэн feature-үүд, тэдгээрийг **нэмэлт** (additive)
> migration-аар хэрхэн нэмэхийг харуулна.
> Холбоотой: [architecture.md](./architecture.md) · [database.md](./database.md) ·
> [decisions.md](./decisions.md)

---

## 0. Залгах цэгүүдийн газрын зураг

```
ӨНӨӨДӨР БАЙГАА ЗҮЙЛ                    ИРЭЭДҮЙД ЮУ ЗАЛГАГДАХ
─────────────────────────              ──────────────────────────────
book_copies.custodian_id      ────────► Cafe custody, delivery, QR
profiles.role='partner' (боломж)────────► Cafe, publisher, partner
ownership_events (append-only)────────► custody_events (ижил механик)
swaps (aggregate root)        ────────► chat threads, payment
notifications (table)         ────────► Supabase Realtime, email, push
private.emit_event()          ────────► outbox → email/push ажилтан
BookSearchIndex (interface)   ────────► Typesense / Meilisearch / ES
RecommendationProvider (iface)────────► ML ranking service
BookImageStorage (interface)  ────────► өөр object storage
EmailSender (interface)       ────────► Resend / Postmark / SES
API surface (features/*)      ────────► mobile app (ижил domain давхарга)
```

---

## 1. Phase 2 — Cafe partner, physical custody, QR

### 1.1 Юу нэмэгдэх вэ

Хэрэглэгч номоо кафед үлдээж, хүлээн авагч тэндээс авдаг болно. Ингэснээр хоёр тал биечлэн
уулзах шаардлагагүй.

```
   Алтан                    Кафе X                     Болд
     │  ном үлдээв            │                          │
     │─────────────────────► │  custodian = Кафе X       │
     │                        │  owner     = Алтан        │
     │                        │                           │
     │                        │  QR-аар баталгаажуулав    │
     │                        │ ◄─────────────────────────│
     │                        │  custodian = Болд         │
     │                        │  owner     = Болд         │
```

### 1.2 Яагаад энэ нь эвдэх өөрчлөлт БИШ вэ

Гурван шийдвэр үүнийг урьдчилан боломжтой болгосон:

1. **`book_copies.custodian_id` аль хэдийн байна** (ADR-009). Багана нэмэх, ~15 query засах,
   4 DTO шинэчлэх ажил **өнөөдөр төлөгдсөн**.
2. **Cafe нь `profiles` мөр болно** (`role='partner'`). `custodian_id` нь `profiles`-руу заасан
   тул **шинэ referenced entity хэрэггүй**.
3. **`copy_status` нь DOMAIN** (ADR-007) — утга нэмэх нь transaction дотор ажиллана.

### 1.3 Бүрэн migration

```sql
-- supabase/migrations/XXXX_custody.sql

-- (1) MVP-ийн инвариантыг хасна — ЭНЭ Л ГАНЦ МӨР "тайлна"
alter table public.book_copies
  drop constraint book_copies_custody_follows_ownership;

-- (2) Статусын шинэ утгууд
alter domain public.copy_status drop constraint copy_status_values;
alter domain public.copy_status add constraint copy_status_values
  check (value in ('available','reserved','swapped','inactive',
                   'in_transit','at_partner_location',
                   'custody_requested','custody_confirmed','lost'));

-- (3) Шинэ role
alter domain public.app_role drop constraint app_role_values;
alter domain public.app_role add constraint app_role_values
  check (value in ('user','moderator','admin','cafe_staff','partner','publisher'));

-- (4) Байршил
create table public.locations (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references public.profiles(id) on delete restrict,
  name         text not null check (length(btrim(name)) between 1 and 120),
  address      text not null,
  district     text,
  lat          numeric(9,6),
  lng          numeric(9,6),
  opening_hours jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- (5) Custody дэвтэр — ownership_events-тэй ИЖИЛ механик, тусдаа table
--     Яагаад тусдаа: ownership event нь "хэн эзэмшдэг вэ", custody event нь
--     "хэн биедээ барьж байна вэ". Нэг эзэмшлийн доор ном кафед олон удаа
--     орж гарч болно — кардиналити огт өөр.
create table public.custody_events (
  id             bigint generated always as identity primary key,
  book_copy_id   uuid not null references public.book_copies(id) on delete restrict,
  from_custodian uuid references public.profiles(id) on delete restrict,
  to_custodian   uuid not null references public.profiles(id) on delete restrict,
  location_id    uuid references public.locations(id) on delete restrict,
  event_type     text not null check (event_type in
                   ('deposit','release','transit_start','transit_end','lost_reported')),
  swap_id        uuid references public.swaps(id) on delete restrict,
  verification   jsonb not null default '{}'::jsonb,   -- QR token hash, staff id
  actor_id       uuid references public.profiles(id) on delete restrict,
  occurred_at    timestamptz not null default now()
);

-- ownership_events-тэй ЯГ ИЖИЛ өөрчлөгдөшгүй байдал
create trigger custody_events_immutable_trg
  before update or delete on public.custody_events
  for each row execute function private.solio_deny_mutation();

alter table public.custody_events enable row level security;
alter table public.custody_events force  row level security;
grant select on public.custody_events to authenticated;
```

### 1.4 Юу өөрчлөгдөхГҮЙ вэ

| Хөндөгдөхгүй | Яагаад |
|---|---|
| `books`, `book_copies`, `book_images` — **бүх багана** | Зөвхөн CHECK constraint суларна |
| `ownership_events` — бүх мөр | Custody нь тусдаа дэвтэрт |
| `swaps`, `swap_items` | Custody нь swap-ийн **гүйцэтгэлийн** механизм, төлөвийн биш |
| `complete_swap()` — үндсэн логик | `custodian_id = to_owner` мөр нөхцөлтэй болно |
| Бүх RLS policy | Шинэ table-д шинэ policy нэмэгдэнэ |
| Хайлт, recommendation, review | Огт хамааралгүй |

### 1.5 Юу үнэхээр өөрчлөгдөх вэ

1. `book_copies_guard` trigger-д custody ирмэгүүд нэмэгдэнэ.
2. `complete_swap()` дотор `custodian_id = i.to_owner` гэсэн хатуу оноолт нь "хэрэв custody нь
   partner дээр биш бол" гэсэн нөхцөлтэй болно.
3. Шинэ RPC-ууд: `deposit_copy()`, `release_copy()`, `verify_qr()`.
4. Шинэ UI: `/locations`, `/custody`.

**QR баталгаажуулалт:** token нь DB-д **hash хэлбэрээр** хадгалагдана (түүхий token биш),
богино хугацаатай, нэг удаагийн. `custody_events.verification`-д hash болон ажилтны id.

---

## 2. Phase 3 — Chat, realtime, delivery, payment

### 2.1 Chat

**Залгах цэг:** `swaps` нь thread-ийн эцэг болно.

```sql
create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  swap_id    uuid unique references public.swaps(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  last_read_at    timestamptz,
  primary key (conversation_id, user_id)
);

create table public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete restrict,
  body            text not null check (length(btrim(body)) between 1 and 4000),
  created_at      timestamptz not null default now()
);
```

**Одоогийн swap систем огт хөндөгдөхгүй.** `conversations.swap_id` нь `swaps`-руу заана —
эсрэгээр биш. Swap нь chat байгаа эсэхийг мэдэхгүй.

RLS: `private.is_swap_participant()` функц **аль хэдийн байна** — chat policy түүнийг шууд
ашиглана.

### 2.2 Realtime мэдэгдэл

`notifications` table аль хэдийн байна. Supabase Realtime-ийг түүн дээр асаана:

```sql
alter publication supabase_realtime add table public.notifications;
```

Клиент талд `supabase.channel().on('postgres_changes', …)`. **DB схем огт өөрчлөгдөхгүй.**
RLS нь Realtime-д ч үйлчилдэг тул хэрэглэгч зөвхөн өөрийн мэдэгдлийг хүлээн авна.

### 2.3 Email / push

**Залгах цэг:** `private.emit_event()` — мэдэгдэл үүсгэдэг цорын ганц дуудлагын цэг.

```sql
-- Outbox — transaction-ы ДОТОР бичигдэж, гадуур илгээгдэнэ
create table public.notification_outbox (
  id              bigint generated always as identity primary key,
  notification_id bigint not null references public.notifications(id) on delete cascade,
  channel         text not null check (channel in ('email','push')),
  status          text not null default 'pending'
                    check (status in ('pending','sent','failed','skipped')),
  attempts        int not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
```

`emit_event()` дотор **нэг INSERT** нэмнэ. Тусдаа ажилтан (Vercel Cron эсвэл Supabase Edge
Function) `pending` мөрүүдийг илгээнэ. Гуравдагч үйлчилгээ унавал transaction барьцаалагдахгүй.

```ts
// src/lib/email/ports.ts — ӨНӨӨДӨР аль хэдийн байгаа interface
export interface EmailSender {
  send(msg: { to: string; template: string; data: Record<string, unknown> }): Promise<void>
}
// MVP:   SupabaseAuthEmailSender  (зөвхөн auth email)
// Дараа: ResendEmailSender | PostmarkEmailSender
```

### 2.4 Delivery

`custody_events`-ийн `transit_start` / `transit_end` дээр тулгуурлана. Шинэ table:

```sql
create table public.deliveries (
  id             uuid primary key default gen_random_uuid(),
  swap_id        uuid not null references public.swaps(id) on delete restrict,
  from_location  uuid references public.locations(id),
  to_location    uuid references public.locations(id),
  courier_id     uuid references public.profiles(id),
  status         text not null default 'requested',
  tracking_code  text unique,
  created_at     timestamptz not null default now()
);
```

### 2.5 Payment

**Тусдаа bounded context.** `swaps`-тай зөвхөн `swap_id`-гаар холбогдоно — `swaps` table нь
payment байгаа эсэхийг мэдэхгүй.

```sql
create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  swap_id        uuid references public.swaps(id) on delete restrict,
  payer_id       uuid not null references public.profiles(id) on delete restrict,
  amount_minor   bigint not null check (amount_minor > 0),   -- мөнгөн тэмдэгтийн хамгийн бага нэгж
  currency       char(3) not null default 'MNT',
  provider       text not null,
  provider_ref   text,
  status         text not null default 'pending',
  created_at     timestamptz not null default now(),
  unique (provider, provider_ref)
);

create table public.payment_events (        -- append-only, ownership_events-тэй ижил хэв маяг
  id          bigint generated always as identity primary key,
  payment_id  uuid not null references public.payments(id) on delete restrict,
  event_type  text not null,
  payload     jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
```

⚠️ **Мөнгөн дүнг `numeric`/`float`-оор бүү хадгал** — `bigint` дээр хамгийн бага нэгжээр
(мөнгө) хадгална. Provider webhook нь Route Handler руу ирнэ (Server Action биш —
гуравдагч тал дуудна).

---

## 3. Phase 4 — Mobile, ахисан хайлт, ML recommendation

### 3.1 Mobile app

**Залгах цэг:** `src/features/*` доторх domain давхарга нь Next.js-ээс **аль хэдийн салангид**.

Хоёр зам:
1. **Шууд Supabase client** — mobile app нь Supabase SDK-г шууд ашиглана. RLS нь ижил
   хамгаалалт өгнө. Хамгийн хурдан зам.
2. **Route Handler API** — `src/app/api/v1/*` нэмж, `features/*/service.ts`-ийг дахин ашиглана.
   Business logic **дахин бичигдэхгүй** — зөвхөн шинэ transport давхарга.

`complete_swap()` шиг RPC-ууд аль ч клиентээс ижил ажиллана.

### 3.2 Гадаад хайлтын систем

```ts
// ӨНӨӨДӨР байгаа interface — өөрчлөгдөхгүй
export interface BookSearchIndex {
  search(query: SearchQuery): Promise<SearchResult>
  onBookUpserted(bookId: string): Promise<void>
  onBookRemoved(bookId: string): Promise<void>
}
```

`onBookUpserted` нь PostgreSQL хэрэгжүүлэлтэд **no-op** боловч **дуудлагын цэг нь аль хэдийн
байна** (`book.created` / `book.updated` event). Typesense нэмэхэд:

1. `TypesenseBookSearchIndex` класс бичнэ.
2. `src/features/search/index.ts`-ийн **нэг мөр** солино.
3. Анхны индексжүүлэлтийн script ажиллуулна.

UI болон domain код **огт хөндөгдөхгүй** — тэдгээр нь зөвхөн `SearchHit` DTO хардаг.

**Мөн шийдэгдэх зүйл:** ADR-020-д тэмдэглэсэн латин галиглалын дутагдал (`mongol` → `монгол`)
гадаад хайлтын систем эсвэл `title_translit` багана нэмэх замаар шийдэгдэнэ.

### 3.3 ML recommendation

```ts
export interface RecommendationProvider {
  recentlyAdded(limit: number): Promise<Rail>
  popular(limit: number, window?: '7d' | '30d'): Promise<Rail>
  forYou(userId: string | null, limit: number): Promise<Rail>
}
```

`forYou` нь **аль хэдийн** `userId: string | null` хүлээж авдаг тул cold-start зам байгаа
бөгөөд мартагдах боломжгүй. ML provider нэмэхэд нэг класс, нэг мөр.

Хэрэв popular rail удаашрах юм бол `book_stats` projection table нэмнэ — **нэмэлт** өөрчлөлт,
interface хөндөгдөхгүй ([decisions.md](./decisions.md), ADR шийдвэр №6).

### 3.4 Хэрэглэгчийн найдвартай байдлын үнэлгээ

ADR-022-д тэмдэглэсэн ялгаа энд хэрэгжинэ:

```sql
create table public.user_ratings (
  id         uuid primary key default gen_random_uuid(),
  swap_id    uuid not null references public.swaps(id) on delete restrict,
  rater_id   uuid not null references public.profiles(id) on delete restrict,
  ratee_id   uuid not null references public.profiles(id) on delete restrict,
  rating     smallint not null check (rating between 1 and 5),
  comment    text check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now(),
  -- ★ ЗААВАЛ дууссан swap-ийн дараа, нэг swap-д нэг үнэлгээ
  unique (swap_id, rater_id)
);
```

`book_reviews`-тэй **огт хольж загварчлаагүй** тул энэ нь цэвэр нэмэлт table.

---

## 4. Өнөөдөр байгаа abstraction-ууд

Эдгээр нь MVP-д **хэрэггүй** байж болох ч ирээдүйн залгах цэг учраас байна:

```ts
// src/lib/storage/ports.ts
export interface BookImageStorage {
  readonly provider: 'r2' | 'local'
  presignUpload(i: { objectKey: string; mimeType: string; byteSize: number }): Promise<PresignedUpload>
  readHead(objectKey: string, bytes: number): Promise<Uint8Array>
  stat(objectKey: string): Promise<{ byteSize: number; mimeType: string } | null>
  delete(objectKey: string): Promise<void>
  publicUrl(objectKey: string): string
}

// src/lib/email/ports.ts
export interface EmailSender {
  send(msg: { to: string; template: string; data: Record<string, unknown> }): Promise<void>
}

// src/features/search/ports.ts        — §3.2
// src/features/recommendations/ports.ts — §3.3
```

**Дүрэм:** аппын бусад хэсэг нь `index.ts`-ээс л импортолно, хэрэгжүүлэлтийн класс руу шууд
хандахгүй. ESLint `no-restricted-imports` үүнийг албадана.

---

## 5. ⚠️ ЭВДЭХ өөрчлөлт үүсгэх зүйлс — эдгээрээс зайлсхий

Ирээдүйн хувь нэмэр оруулагчид уншина уу. Дараах өөрчлөлтүүд нь **устгах migration**
шаардах болно:

| Хийж болохгүй зүйл | Яагаад эвдэрнэ |
|---|---|
| `ownership_events`-ийн мөр устгах/засах | Өмчлөлийн гинж тасарна; `book_copies.owner_id`-тай зөрөх бүрэн бүтэн байдлын шалгалт унана |
| `book_copies` мөрийг физикээр устгах | `ownership_events`, `swap_items` дэх FK-ууд тасарна. `status='inactive'` ашигла |
| `books` болон `book_copies`-ыг нэгтгэх | Өмчлөл нь хуваалцсан мөрийн шинж чанар болно — бүх swap логик утгагүй болно |
| `custodian_id`-г устгах | Phase 2 бүхэлдээ дахин бичигдэнэ |
| `role`-ыг `profiles`-руу буцааж зөөх | Эрх дээшлүүлэх эмзэг байдал сэргэнэ (ADR-006) |
| `swaps`-д INSERT/UPDATE GRANT өгөх | PostgREST-ээр шууд бичих зам нээгдэж, state machine тойрогдоно |
| `complete_swap`-аас `search_path = ''` хасах | `SECURITY DEFINER` хууран мэхлэлтийн эмзэг байдал |
| `SECURITY DEFINER`-гүй RLS туслах функц бичих | `42P17` infinite recursion |
| `auth.users`-д багана нэмэх | Supabase-ийн шууд зөвлөмжийн эсрэг; шинэчлэлт дээр устаж болно |
| Email/утсыг `public` schema руу зөөх | ADR-013-ийн бүтцийн хамгаалалт устана |
| `ts_headline`-ийн гаралтыг `dangerouslySetInnerHTML`-д өгөх | Хадгалагдсан XSS |
| Мөнгөн дүнг `float`/`numeric`-ээр хадгалах | Бөөрөнхийлөлтийн алдаа |
| `dangerouslyAllowSVG: true` тавих | Хэрэглэгчийн байршуулсан SVG = хадгалагдсан XSS |

---

## 6. Feature бүрийн өргөтгөлийн хураангуй

| Feature | Шинэ table | Одоо байгаа table засах | Устгах өөрчлөлт үү |
|---|---|---|---|
| Cafe custody | `locations`, `custody_events` | 1 constraint хасах, 2 DOMAIN өргөтгөх | ❌ Үгүй |
| QR баталгаажуулалт | (`custody_events.verification` дотор) | — | ❌ Үгүй |
| Chat | `conversations`, `conversation_participants`, `messages` | — | ❌ Үгүй |
| Realtime мэдэгдэл | — | `publication` нэмэх | ❌ Үгүй |
| Email/push | `notification_outbox` | `emit_event()` дотор 1 INSERT | ❌ Үгүй |
| Delivery | `deliveries` | — | ❌ Үгүй |
| Payment | `payments`, `payment_events` | — | ❌ Үгүй |
| Mobile app | — | — | ❌ Үгүй |
| Гадаад хайлт | — | — | ❌ Үгүй (interface) |
| ML recommendation | (`book_stats` сонголтоор) | — | ❌ Үгүй (interface) |
| Хэрэглэгчийн үнэлгээ | `user_ratings` | — | ❌ Үгүй |

**Бүх мөрөнд "Үгүй".** Энэ бол Phase 0-ийн архитектурын гол зорилго байсан.
