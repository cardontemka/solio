# Solio — Архитектурын тойм

> Ном солилцох community платформын системийн бүтэц, хариуцлагын хуваарилалт, давхаргын дүрэм.
> Холбоотой баримтууд: [database.md](./database.md) · [security.md](./security.md) ·
> [transactions.md](./transactions.md) · [setup.md](./setup.md) ·
> [future-expansion.md](./future-expansion.md) · [decisions.md](./decisions.md) · [roadmap.md](./roadmap.md)

---

## 1. Бүтээгдэхүүний товч

Solio бол хэрэглэгчид өөрсдийн эзэмшдэг **бодит физик номоо** бүртгэж, бусад хэрэглэгчийн номтой
barter/swap хэлбэрээр солилцдог платформ. Хэрэглэгч номоо зураг, нөхцөл (condition), тайлбартай нь
бүртгэнэ. Өөр хэрэглэгч тухайн номыг хүсвэл өөрийн нэг номоо санал болгож swap request илгээнэ. Хоёр
тал биечлэн гардуулснаа баталгаажуулсны дараа **өмчлөл системд шилжиж**, тэр шилжилтийн бүрэн,
өөрчлөгдөшгүй бүртгэл үүснэ.

Системд байхгүй номыг хэрэглэгч wishlist/book request хэлбэрээр хүсэж болно. Хожим хэн нэгэн тохирох
ном нэмэхэд хүсэлт гаргасан хэрэглэгчид in-app мэдэгдэл очно.

Энэ бол demo биш. Зорилго нь **cafe/custody, chat, payment, mobile** зэргийг хожим нэмэхэд database
болон domain давхаргыг бүхэлд нь дахин бичих шаардлагагүй, production-д ойр суурьтай MVP.

---

## 2. Хүсэлтийн зам (request path)

```
                    ┌──────────────┐
                    │   Хэрэглэгч   │
                    │   (browser)   │
                    └───────┬──────┘
                            │ HTTPS
                            ▼
          ┌─────────────────────────────────────┐
          │            Cloudflare               │
          │  DNS · TLS · CDN · WAF · Bot        │
          │  protection · Turnstile · rate rules │
          └─────────────────┬───────────────────┘
                            │
                            ▼
          ┌─────────────────────────────────────┐
          │        Vercel / Next.js 16          │
          │  src/proxy.ts   (session refresh)   │
          │  Server Components (уншилт)          │
          │  Server Actions   (бичилт)           │
          │  Route Handlers   (callback/upload)  │
          │  features/*       (domain logic)     │
          └────────┬──────────────────┬─────────┘
                   │                  │
        Supabase   │                  │  presigned PUT
        client     │                  │  (browser → R2 шууд)
                   ▼                  ▼
   ┌───────────────────────────┐   ┌──────────────────────┐
   │   Supabase                │   │  Cloudflare R2       │
   │   ├── Auth (auth.users)   │   │  номын зураг          │
   │   ├── PostgreSQL          │   │  copies/{id}/{id}.webp│
   │   └── RLS + triggers  ◄───┼── │                      │
   │       ЖИНХЭНЭ ХИЛ ХЯЗГААР  │   └──────────────────────┘
   └───────────────────────────┘              │
                                              │ public custom domain
                                              ▼
                                     images.solio.mn (CDN)
```

**Гол санаа:** дээрх бүх давхарга нь *defence in depth* — жинхэнэ authorization хил хязгаар нь
**PostgreSQL RLS болон trigger** дээр байна. UI дээрх шалгалт, proxy дээрх redirect, Server Action
доторх шалгалт бүгд түүний нэмэлт хамгаалалт болохоос орлуулагч биш.

---

## 3. Next.js доторх бүтэц

```
Next.js 16 (App Router)
 ├── src/app/**            UI — Server Components үндсэн, 'use client' зөвхөн шаардлагатай газар
 ├── src/components/**     презентацийн компонент, business logic АГУУЛАХГҮЙ
 ├── src/features/**       ⬅ БҮХ business logic энд
 │    ├── actions.ts       'use server' — мутаци бүрийн орох цэг
 │    ├── service.ts       domain үйлдэл, RPC дуудлага
 │    ├── queries.ts       уншилт (DAL)
 │    ├── schema.ts        Zod validation + статус утгуудын жагсаалт
 │    └── dto.ts           DB мөр → UI-д аюулгүй объект
 ├── src/lib/**            дэд бүтцийн адаптерууд (supabase, storage, auth, permissions…)
 └── src/proxy.ts          session refresh + CSP nonce + optimistic redirect
```

---

## 4. Хариуцлагын хуваарилалт

| Давхарга | Юуг хариуцна | Юуг ХАРИУЦАХГҮЙ |
|---|---|---|
| **Cloudflare** | DNS, TLS, CDN cache, WAF, bot protection, Turnstile, ирмэг дэх rate limit | Хэрэглэгчийн эрхийн шалгалт, өгөгдлийн бүрэн бүтэн байдал |
| **Vercel / Next.js** | Rendering, routing, session cookie сэргээлт, domain logic, validation, R2 presign, алдааны боловсруулалт | Эцсийн authorization (энэ нь DB дээр), файлын байт хадгалалт |
| **Supabase Auth** | Бүртгэл, нэвтрэлт, email баталгаажуулалт, нууц үг сэргээх, JWT/session | Business өгөгдөл, role |
| **Supabase PostgreSQL + RLS** | **Эцсийн authorization**, өгөгдлийн бүрэн бүтэн байдал, atomic transaction, state machine, өөрчлөгдөшгүй түүх, хайлт | Файлын байт, UI |
| **Cloudflare R2** | Номын зургийн байт, CDN-ээр түгээх | Хэн юу үзэж болохыг шийдэх (зураг нь public контент) |

---

## 5. Яагаад ийм сонголт хийсэн бэ

### 5.1 Modular monolith — microservices биш

Нэг Next.js апп, нэг PostgreSQL. `src/features/*` доторх модулиуд нь тодорхой хилтэй ч нэг process-д
ажиллана.

**Давуу тал:** swap completion шиг олон entity-д хүрдэг үйлдлийг **нэг database transaction**-д
багтаах боломжтой. Microservices бол distributed transaction/saga хэрэгтэй болно — MVP-д зохисгүй
нарийвчлал. Deploy нэг, лог нэг, орчны хувьсагч нэг.

**Сул тал:** нэг модуль унавал бүхэлдээ унана; масштаблахдаа бүхэлд нь масштаблана.

**Хэзээ өөрчлөх вэ:** search эсвэл image processing нь бусдаас 10 дахин их нөөц иддэг болсон үед л.

### 5.2 RLS — зөвхөн application-level authorization биш

Supabase-ийн publishable key нь **browser дотор** байдаг. Тэр key-тэй хэн ч PostgREST рүү шууд
хүсэлт илгээж чадна. Тиймээс "Server Action дотор шалгасан" гэдэг хангалтгүй — халдагч Server
Action-г огт дуудахгүй.

**Тиймээс:** table бүр дээр RLS асаалттай, `authenticated` role-д яг хэрэгтэй GRANT л өгөгдөнө.
Өмчлөл өөрчлөх зэрэг эмзэг үйлдэл нь `SECURITY DEFINER` function-аар л явна, тэднийг trigger
хамгаална.

**Сул тал:** policy бичих нь илүү хөдөлмөр шаардана, debug хийхэд төвөгтэй. Хариуд нь халдагч
API-г шууд дуудсан ч хамаагүй болно.

### 5.3 PostgreSQL FTS + pg_trgm — Elasticsearch биш

MVP-ийн хэмжээнд (<100k ном) PostgreSQL-ийн хайлт хангалттай хурдан. Elasticsearch нэмэх нь: шинэ
дэд бүтэц, синхрончлолын асуудал, өөр нэг унах цэг, өөр нэг төлбөр.

**Гол нөхцөл:** хайлтыг `BookSearchIndex` interface-ийн ард нуусан. Хожим Typesense/Meilisearch
руу шилжихэд **нэг класс бичээд нэг мөр солино** — UI болон domain код хөндөгдөхгүй.
Дэлгэрэнгүй: [database.md §7](./database.md).

### 5.4 Cloudflare R2 — Postgres binary эсвэл Supabase Storage биш

Зургийг Postgres-д хадгалбал backup томорч, dump удааширч, DB-ийн cache зурагаар дүүрнэ.
R2 нь **egress төлбөргүй** — CDN-ээр их зураг түгээхэд Supabase Storage-аас хямд. Brief мөн R2-г
тодорхой заасан.

**Сул тал:** DB болон object storage хоёрын хооронд тогтвортой байдал (orphan object) өөрсдөө
хариуцна — тиймээс `book_images.status` (`pending`/`ready`/`removed`) болон цэвэрлэгээний
механизм заавал байна.

### 5.5 CSS Modules — Tailwind биш

Brief-д CSS Modules заасан. `create-next-app` Tailwind v4 суулгасан тул түүнийг **бүрэн хасна**
(`tailwindcss`, `@tailwindcss/postcss` dependency, `postcss.config.mjs`, `globals.css` доторх
`@import "tailwindcss"`, `page.tsx`-ийн utility className-ууд).

Хоёуланг зэрэг барих нь: хоёр төрлийн styling систем, хоёр эх сурвалж, тодорхойгүй давуу эрх.

### 5.6 Server Actions — REST endpoint биш

Мутаци бүр Server Action. Шалтгаан: React-аас шууд дуудагдана, CSRF хамгаалалт (Origin/Host
шалгалт) автоматаар ирнэ, зөвхөн POST, action ID шифрлэгдсэн.

Route Handler зөвхөн **гурван тохиолдолд**: (1) гуравдагч тал browser-ийг чиглүүлж байгаа
(auth callback), (2) R2 presigned URL олгох, (3) UI биш контент буцаах (CSV export).

---

## 6. Архитектурын үндсэн зарчим

Эдгээр нь тохиргоо биш — **зөрчиж болохгүй зарчим**.

### 6.1 `books` ≠ `book_copies`

```
books (хийсвэр бүтээл)              book_copies (бодит физик ном)
─────────────────────              ────────────────────────────
"Монголын нууц товчоо"      1 ──*   #1  owner=Алтан   condition=good
title, author, isbn                 #2  owner=Болд     condition=new
publisher, description              #3  owner=Цэцэг    condition=fair
```

`books` нь **хайлт, review, wishlist, SEO URL**-ийн нэгж — бүх эзэмшигчид хуваалцана.
`book_copies` нь **өмчлөл, нөхцөл, статус, зураг, swap**-ийн нэгж.

Хэрэв нэгтгэвэл өмчлөл нь хуваалцсан мөрийн шинж чанар болж, хоёр хүн нэг мөрийг эзэмших болно.

### 6.2 Ownership ≠ Custody

**Owner** = хуулийн эзэмшигч. **Custodian** = яг одоо биедээ барьж байгаа тал.

MVP-д `custodian_id = owner_id` бөгөөд үүнийг DB constraint баталгаажуулна. Гэхдээ багана
**өнөөдөр байна** — учир нь хожим "энэ ном хаана байна?" гэж асуух бүх query, DTO, UI binding
аль хэдийн түүнийг сонгож байх болно. Дараа нэмэх нь хямд, дараа retrofit хийх нь үнэтэй.

Cafe/partner нь ирээдүйд `profiles` дээрх `role='partner'` мөр болно — тиймээс `custodian_id` нь
`profiles`-руу заана, тусдаа `partners` table хэрэггүй.

### 6.3 Current State + Event History — хоёулаа

```
Одоогийн төлөв                 Түүх (append-only)
──────────────                 ───────────────────
book_copies.owner_id           ownership_events
book_copies.status               ├─ initial_registration  (NULL → Алтан)
                                 ├─ swap_transfer         (Алтан → Болд)
                                 └─ swap_transfer         (Болд  → Цэцэг)
```

**Инвариант:** `book_copies.owner_id` нь тухайн хуулбарын хамгийн сүүлийн `ownership_events`
мөрийн `to_owner_id`-тэй **үргэлж тэнцүү**. Гинжин холбоо тасрахгүй:
`from_owner_id[n] = to_owner_id[n-1]`, `from_owner_id[0] IS NULL`.

Хоёулаа нэг statement-д (нэг CTE) бичигддэг тул зөрөх боломжгүй.

### 6.4 Өмчлөл зөвхөн зөвшөөрөгдсөн business үйлдлээр өөрчлөгдөнө

`PATCH /books/:id/owner` төрлийн endpoint **байхгүй**. `book_copies.owner_id`-г бичдэг цорын ганц
код бол `public.complete_swap()` function (болон admin-ийн засварын `admin_correct_ownership()`).
`book_copies_guard` trigger нь бусад бүх замаас ирсэн `owner_id` өөрчлөлтийг таслана — `service_role`
key ашигласан ч гэсэн, учир нь trigger нь `BYPASSRLS` role дээр ч ажиллана.

---

## 7. Хавтасны бүтэц

```
/                                   ← repo root (Next 16 эдгээрийг энд шаарддаг)
├── next.config.ts  tsconfig.json  package.json  eslint.config.mjs
├── .env.local  .env.example  .gitignore
├── public/                         статик файл (favicon г.м.)
├── supabase/
│   ├── config.toml                 local stack тохиргоо, git-д commit хийгдэнэ
│   ├── migrations/*.sql            schema өөрчлөх ЦОРЫН ГАНЦ зам
│   ├── seed.sql                    зөвхөн development өгөгдөл
│   └── tests/*.test.sql            pgTAP — RLS, state machine, immutability
├── docs/                           энэ баримт бичгүүд
└── src/
    ├── proxy.ts                    session сэргээлт + CSP nonce + optimistic redirect
    ├── app/
    │   ├── layout.tsx  page.tsx  globals.css
    │   ├── error.tsx  not-found.tsx  forbidden.tsx  unauthorized.tsx
    │   ├── robots.ts  sitemap.ts
    │   ├── (auth)/                 login · register · reset-password · verify-email
    │   ├── books/                  feed · new · [id] · [id]/edit
    │   ├── search/
    │   ├── u/[username]/           нийтийн профайл (индексжинэ)
    │   ├── profile/                хувийн: тохиргоо, миний номнууд, түүх
    │   ├── wishlist/  swaps/  notifications/
    │   ├── (admin)/admin/          users · books · copies · swaps · reports ·
    │   │                           reviews · ownership-events · audit-logs
    │   └── api/
    │       ├── auth/callback/route.ts
    │       ├── uploads/book-image/route.ts
    │       └── admin/export/audit-logs/route.ts
    ├── components/                 презентацийн компонент
    ├── features/                   ⬅ БҮХ business logic
    │   ├── books/  swaps/  images/  wishlist/  reviews/  reports/
    │   ├── notifications/  users/  moderation/
    │   ├── search/                 ports.ts · postgres-search-index.ts · index.ts
    │   └── recommendations/        ports.ts · scoring.ts · rails.ts · index.ts
    ├── lib/
    │   ├── supabase/               client.ts · server.ts · admin.ts · proxy.ts
    │   ├── auth/                   dal.ts · roles.ts
    │   ├── db/                     errors.ts · cursor.ts · retry.ts
    │   ├── permissions/            require.ts
    │   ├── storage/                ports.ts · r2.ts · local.ts · index.ts
    │   ├── validation/             env.ts · schemas.ts
    │   ├── email/                  ports.ts · supabase-email.ts · index.ts
    │   └── rate-limit.ts  analytics.ts  logger.ts  errors.ts
    ├── types/database.ts           supabase gen types typescript --local
    └── tests/                      unit/ · integration/ · security/
```

`app/` хавтас `src/app/` руу шилжинэ. `public/`, `next.config.ts`, `tsconfig.json`, `.env.*` нь
root-д үлдэнэ (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/src-folder.md`).

---

## 8. Давхаргын дүрэм (ESLint-ээр албадана)

| Дүрэм | Яагаад |
|---|---|
| `src/app/**` нь `lib/supabase/**`-ийг **импортлохгүй**; зөвхөн `features/*/actions.ts`, `features/*/queries.ts` | DAL нь database-руу орох цорын ганц хаалга байх ёстой |
| `lib/supabase/admin.ts`-ийг зөвхөн `lib/**` болон `features/**/service.ts` импортолно | service key нь RLS-ийг тойрдог — компонент түүнд хүрч болохгүй |
| `lib/**` болон `features/**/{service,queries}.ts` бүр `import 'server-only'`-оор эхэлнэ | client талаас импортлох оролдлого **build алдаа** болно, runtime алдаа биш |
| `process.env`-д зөвхөн `lib/validation/env.ts` хүрнэ | secret нь аппын бусад хэсэгт тархахгүй |
| `components/**` нь `features/**/service.ts`-ийг импортлохгүй | business logic React дотор орохгүй |

---

## 9. Next.js 16-ийн онцлогууд

Энэ хувилбар нь сургалтын өгөгдөлд байгаа Next.js-ээс **ялгаатай**. Баталгаажуулсан эх сурвалж:
`node_modules/next/dist/docs/`.

| Онцлог | Тайлбар |
|---|---|
| `middleware.ts` → **`proxy.ts`** | Next 16-д `middleware` deprecated болж `proxy` болсон (`03-file-conventions/proxy.md`, `middleware.md`). Supabase-ийн интернэт дэх бүх "middleware session refresh" заавар хуучирсан. |
| `proxy.ts` нь **authorization хил биш** | Prefetch дээр ч ажиллана, DB уншилт хийхгүй. Зөвхөн cookie сэргээх + optimistic redirect. |
| Route props global type | `PageProps<"/books/[id]">`, `LayoutProps<"/">` — гараар тайлбарлахгүй |
| `use cache` / `cacheLife` / `cacheTag` / `updateTag` | Зөвхөн **нийтийн** өгөгдөлд. Хэрэглэгч тус бүрийн өгөгдлийг framework түвшинд cache хийхгүй |
| `forbidden()` / `unauthorized()` + `forbidden.tsx` | `experimental.authInterrupts` шаардлагатай |
| `after()` | Хариу илгээсний дараа ажиллах ажил (analytics, R2 цэвэрлэгээ) |

**`cacheComponents` МVP-д асаахгүй** — PPR-ийг дагуулдаг бөгөөд nonce-based CSP-тэй зөрчилдөнө.
Одоогийн бүтэц (Suspense, DAL) нь түүнд бэлэн тул хожим нэмэх нь **нэмэлт** өөрчлөлт болно.

---

## 10. Brief-ийн хүснэгтээс хассан table-ууд

Brief §62 доод хэмжээний entity жагсаалт өгсөн. Дараах хоёрыг **хассан**, тус бүрийн үндэслэл:

### 10.1 `wishlists` — `book_requests` дотор нэгтгэсэн

Wishlist мөр гэдэг нь "надад **системд байгаа** X ном хэрэгтэй"; book request нь "надад **системд
байхгүй** ном хэрэгтэй". Хоёулаа нэг өгүүлбэр: *хэрэглэгч ном хүсэж байгаа бөгөөд түүний хуулбар
гарч ирэхэд мэдэгдэл авах ёстой.*

`book_requests.book_id` nullable — `NOT NULL` бол wishlist (шинэ хуулбар дээр яг тааруулна),
`NULL` бол чөлөөт текст хүсэлт (ISBN, дараа нь trigram гарчгаар тааруулна).

Хоёр table байвал: RLS policy давхардана, мэдэгдлийн зам давхардана, "миний хүссэн номнууд" UI
хоёр эх сурвалжтай болно, matcher шинэ ном бүр дээр хоёр удаа ажиллана.

**Хожим салгах өртөг:** зан төлөв нь салбарлавал (жишээ нь request нь нийтийн "хайж байна" самбартай
болох) `create table wishlists as select … where book_id is not null` + нэг policy багц.

### 10.2 `profiles_private` — үүсгээгүй; email/phone нь `auth.users`-д үлдэнэ

Brief §4 "private account data-г тусгаарла" гэсэн. Хамгийн **хатуу** тусгаарлалт бол `public`
schema-д хувийн багана **огт байхгүй** байх явдал.

PostgREST зөвхөн `public` schema-г (болон тодорхой тохируулсан schema-г) харуулдаг. `auth` schema
харуулагддаггүй. Тиймээс *"A нь B-ийн email-ийг уншиж чадах уу?"* гэсэн асуулт **policy-гоор биш,
бүтцээрээ** үгүй болно — тэр өгөгдлийг агуулсан мөр нээлттэй schema-д огт байхгүй.

- Хэрэглэгч өөрийн email-ээ `supabase.auth.getUser()`-ээр уншина (JWT-scoped, өөрийнхийг л буцаана).
- Admin нь `supabaseAdmin.auth.admin.listUsers()`-ээр, `server-only` модуль дотор, admin шалгалтын
  ард, **audit бичлэгтэйгээр** уншина.

RLS-тэй хоёр дахь table нь энэ хувилбараас **сул** — нэг буруу policy бичихэд задарна.

**Хожим нэмэх өртөг:** үнэхээр хувийн domain талбар гарвал (cafe custody-д зориулсан утас)
`create table profiles_private (user_id uuid primary key references profiles(id) on delete cascade,
phone text)` + 3 policy = ~12 мөрийн **нэмэлт** migration, backfill шаардлагагүй.

### 10.3 Нэмэгдсэн table: `user_roles`

Brief-д байгаагүй ч нэмсэн. `profiles.role` гэж хадгалбал `profiles`-д өөрийн мөрөө засах UPDATE
policy байдаг тул **нэг policy алдаа = privilege escalation**. Role-ийг тусдаа table-д, `authenticated`
role-д ямар ч INSERT/UPDATE grant-гүйгээр хадгална. Шалгалт нь `private.has_role()`
`SECURITY DEFINER` function-аар явна.

---

## 11. MVP-д ЗОРИУДААР хийхгүй зүйлс

| Feature | Ирээдүйн залгах цэг (seam) |
|---|---|
| Cafe / physical custody / QR | `book_copies.custodian_id` аль хэдийн байна; `custody_events` table нэмнэ |
| Chat | `swaps` table нь thread-ийн эцэг болно; `conversations`/`messages` нэмнэ |
| Payment | Тусдаа bounded context; `swaps`-тай `swap_id`-гаар холбогдоно |
| Delivery | `custody_events` дээр тулгуурлана |
| Realtime notification | `notifications` table аль хэдийн байна — Supabase Realtime түүн дээр асаана |
| Email/push notification | `emit_event()` function нь цорын ганц дуудлагын цэг — outbox тэнд залгагдана |
| AI/ML recommendation | `RecommendationProvider` interface — нэг класс солино |
| External search engine | `BookSearchIndex` interface — нэг класс солино |

Дэлгэрэнгүй: [future-expansion.md](./future-expansion.md).
