# Solio — Аюулгүй байдал

> Заналхийллийн загвар, эрхийн матриц, RLS policy бүр, файл байршуулалтын хамгаалалт, болон
> production-д гаргахын өмнөх аудитын жагсаалт.
> Холбоотой: [database.md](./database.md) · [transactions.md](./transactions.md) ·
> [architecture.md](./architecture.md)

> **Энэ баримт дахь бүх RLS policy болон §11-ийн аудитын тестүүд PostgreSQL 17 дээр бодитоор
> ажиллуулж шалгагдсан.** Хэмжсэн үр дүн §11-д байна.

---

## 1. Заналхийллийн загвар

**Халдагч гэж хэн бэ:** хүчинтэй бүртгэлтэй, нэвтэрсэн жирийн хэрэглэгч.

**Тэр юу хийж чадах вэ:**

1. Клиентийн JS bundle-ийг бүрэн уншина → `NEXT_PUBLIC_SUPABASE_ANON_KEY`-г олно.
2. Тэр key-ээр **PostgREST рүү шууд** хүсэлт илгээнэ — таны Server Action-г огт дуудахгүй.
3. URL дээрх ID-г солино (`/books/123` → `/books/124`).
4. Server Action-г гараар, дурын аргументтэй дуудна.
5. Хүсэлтийн body/header-ийг өөрчилнө, өөр хэрэглэгчийн `userId` илгээнэ.
6. Хуурамч зураг, гүйцэтгэгдэх файлыг зургийн нэрээр байршуулна.

**Дүгнэлт:** UI дээрх шалгалт, `if` нөхцөл, нуусан товч — эдгээрийн **аль нь ч** хамгаалалт биш.
Жинхэнэ хил хязгаар нь **PostgreSQL RLS болон trigger** дээр байна.

---

## 2. Хамгаалалтын давхаргууд

```
   ┌─────────────────────────────────────────────────────────┐
   │ 1. Cloudflare      WAF · bot · rate limit · Turnstile   │  DDoS/spam
   ├─────────────────────────────────────────────────────────┤
   │ 2. src/proxy.ts    session сэргээх · optimistic redirect │  ⚠ хил ХЯЗГААР БИШ
   ├─────────────────────────────────────────────────────────┤
   │ 3. Server Action   authn · Zod · rate limit · authz      │  defence in depth
   ├─────────────────────────────────────────────────────────┤
   │ 4. SECURITY DEFINER RPC   түгжээ · дахин унших · шалгах  │  ✅ жинхэнэ хил
   ├─────────────────────────────────────────────────────────┤
   │ 5. TRIGGER         state machine · immutability          │  ✅ service_role-ыг ч барина
   ├─────────────────────────────────────────────────────────┤
   │ 6. RLS + GRANT     мөр бүрийн хандалт                    │  ✅ ЭЦСИЙН ХИЛ
   └─────────────────────────────────────────────────────────┘
```

### 2.1 Яагаад `proxy.ts` нь authorization хил БИШ вэ

Next.js 16-ийн баримт (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`,
`data-security.md`) тодорхой хэлдэг:

- Proxy нь **prefetch** дээр ч ажиллана — тэнд DB унших нь гүйцэтгэлийг сүйтгэнэ.
- Proxy нь ердөө cookie байгаа эсэхийг л шалгана, тухайн cookie **юу зөвшөөрч байгааг** биш.
- Route Handler-ууд proxy matcher-аас **хасагдсан** тул тэдэнд proxy огт хамаарахгүй.
- Server Action нь тусдаа route биш — тэдгээр нь **тодорхойлогдсон хуудасныхаа** POST юм.
  Тиймээс action-ыг өөр хуудас руу зөөхөд proxy-ийн хамгаалалт чимээгүй алга болно.

**Тиймээс:** proxy зөвхөн (1) Supabase session cookie сэргээх, (2) нэвтрээгүй хэрэглэгчийг
хувийн замаас optimistic redirect хийх, (3) CSP nonce тавих. **Бодит шалгалт бүр Server Action
эсвэл RPC дотор дахин хийгдэнэ.**

```ts
// src/proxy.ts — Next 16 (middleware.ts БИШ)
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const PRIVATE = ['/profile', '/swaps', '/wishlist', '/notifications', '/admin']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options))
        },
      },
    }
  )

  // ⚠ getUser() — getSession() БИШ. getUser() нь token-ыг Supabase дээр
  //   баталгаажуулдаг; getSession() зөвхөн cookie-г уншдаг тул хуурамчилж болно.
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  if (!user && PRIVATE.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
```

> ⚠️ `matcher`-аас `api/` хассан нь **зориудаар**. Route Handler бүр өөрийн Supabase client-ээ
> үүсгэж, өөрөө 401/403 шалгана.

---

## 3. Эрхийн матриц

**Тэмдэглэгээ:** `R:нэр` = RLS policy · `G` = GRANT байхгүй · `F:нэр` = функцийн дотоод шалгалт ·
`T:нэр` = trigger · `A` = Supabase Auth · `SK` = service key зам (админ, audit бичигдэнэ)

**Багана:** **AN** нэргүй · **OW** мөрийн эзэн · **OT** нэвтэрсэн, хамааралгүй ·
**CP** swap-ийн нөгөө тал · **MO** moderator · **AD** admin

### 3.1 Данс ба профайл

| Үйлдэл | AN | OW | OT | CP | MO | AD | Хаана албадана |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Бүртгүүлэх | ✓ | – | – | – | – | – | `A` + Turnstile |
| Нэвтрэх | ✓ | – | – | – | – | – | `A` + Turnstile |
| Гарах | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | `A` |
| Email баталгаажуулах | ✓(token) | ✓ | ✗ | ✗ | ✗ | ✗ | `A` нэг удаагийн token |
| Нууц үг сэргээх хүсэх | ✓ | ✓ | – | – | – | – | `A` + Turnstile |
| **Өөрийн email/утас унших** | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | `A` `getUser()` |
| **ӨӨР хүний email унших** | ✗ | – | ✗ | ✗ | ✗ | ✓ | `G` (auth schema ил гараагүй) / `SK` + audit |
| Нийтийн профайл унших | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `R:profiles_select_public` |
| Өөрийн профайл засах | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | `R:profiles_update_self` |
| **Өөрийгөө admin болгох** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `G` — `user_roles`-д INSERT эрх огт байхгүй |
| Хэрэглэгчид role өгөх | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | `F:admin_set_role` + audit |
| Хэрэглэгч түдгэлзүүлэх | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | `F:moderate_profile` + audit |

### 3.2 Ном ба хуулбар

| Үйлдэл | AN | OW | OT | CP | MO | AD | Хаана |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Идэвхтэй ном унших | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `R:books_select_public` |
| Нуугдсан ном унших | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | `R:books_select_public` (`is_staff`) |
| Ном үүсгэх | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | `R:books_insert_authenticated` |
| Номын metadata засах | ✗ | ✓* | ✗ | ✗ | ✓ | ✓ | `R:books_update_creator` |
| Хуулбар үүсгэх | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | `R:book_copies_insert_own` |
| **Өөр хүний хуулбар засах** | ✗ | – | ✗ | ✗ | ✓ | ✓ | `R:book_copies_update_own` |
| **Хуулбарын `owner_id` бичих** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `T:book_copies_guard` — **хэн ч чадахгүй** |
| Хуулбар устгах | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `T` — DELETE бүрэн хориотой |
| Хуулбар `inactive` болгох | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | `T:book_copies_guard` |

\* Номын metadata-г үүсгэгч зөвхөн **өөр хүн тухайн номын хуулбар эзэмшиж эхлээгүй** үед засна.
Дараа нь зөвхөн moderator.

### 3.3 Зураг, сэтгэгдэл, хүсэлт

| Үйлдэл | AN | OW | OT | MO | AD | Хаана |
|---|:--:|:--:|:--:|:--:|:--:|---|
| `ready` зураг харах | ✓ | ✓ | ✓ | ✓ | ✓ | `R:book_images_select_public` |
| Зураг байршуулах | ✗ | ✓ | ✗ | ✗ | ✗ | `R:book_images_insert_owner` + `F:owns_copy` |
| **Өөр хүний зураг устгах** | ✗ | – | ✗ | ✓ | ✓ | `R:book_images_update_owner` |
| Сэтгэгдэл унших | ✓ | ✓ | ✓ | ✓ | ✓ | `R:book_reviews_select_public` |
| Сэтгэгдэл бичих | ✗ | ✓ | ✓ | ✓ | ✓ | `R:book_reviews_insert_own` |
| Давхар сэтгэгдэл | ✗ | ✗ | ✗ | ✗ | ✗ | `unique(user_id, book_id)` |
| **Өөр хүний wishlist харах** | ✗ | – | ✗ | ✓ | ✓ | `R:book_requests_select_own` |

### 3.4 Swap, өмчлөл, лог

| Үйлдэл | AN | OW | OT | CP | MO | AD | Хаана |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| **Swap харах** | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | `R:swaps_select_participant` |
| Swap хүсэх | ✗ | ✓ | ✓ | – | ✓ | ✓ | `F:request_swap` |
| Swap хүлээн авах/татгалзах | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | `F:respond_to_swap` |
| **Swap дангаараа дуусгах** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `F:complete_swap` (`confirmed_by <> actor`) |
| **Swap шууд UPDATE хийх** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `G` — INSERT/UPDATE/DELETE эрх огт байхгүй |
| Өмчлөлийн түүх харах | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `R:ownership_events_select` (ил тод байдал) |
| **Өмчлөлийн түүх бичих** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `G` + `T` — зөвхөн RPC дотроос |
| **Өмчлөлийн түүх засах/устгах** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | `T:solio_deny_mutation` — **`postgres` ч чадахгүй** |
| Audit log унших | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | `R:audit_logs_select_staff` |
| Өөрийн мэдэгдэл унших | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | `R:notifications_select_own` |

---

## 4. RLS policy-ийн бүрэн багц

> **Дүрэм:** `auth.uid()`-г үргэлж `(select auth.uid())` гэж боож бичнэ. Ингэснээр PostgreSQL
> үүнийг `InitPlan` болгож нэг удаа тооцно; боохгүй бол **мөр бүрд** дахин тооцогдоно.

### 4.1 Туслах функцууд

RLS policy дотроос дуудагдах функц нь **заавал `SECURITY DEFINER`** байх ёстой — эс бөгөөс өөрөө
RLS-д баригдаж `42P17` (infinite recursion) алдаа өгнө.

```sql
create or replace function private.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.user_roles
                      where user_id = (select auth.uid()) and role = p_role) $$;

create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.user_roles
                      where user_id = (select auth.uid())
                        and role in ('moderator','admin')) $$;

create or replace function private.is_active_account()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles
                      where id = (select auth.uid()) and account_status = 'active') $$;

create or replace function private.owns_copy(p_copy uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.book_copies
                      where id = p_copy and owner_id = (select auth.uid())) $$;

create or replace function private.is_swap_participant(p_swap uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.swaps
                      where id = p_swap
                        and (select auth.uid()) in (requester_id, responder_id)) $$;
```

> **`set search_path = ''` нь заавал.** Үүнгүй бол халдагч өөрийн schema үүсгэж, ижил нэртэй
> хуурамч функц/table байрлуулж `SECURITY DEFINER` функцийг хууран мэхэлж болно. Хоосон
> `search_path` нь бүх нэрийг бүрэн тодотгохыг албадана.

### 4.2 GRANT — policy-оос ТУСДАА шалгалт

```sql
grant select                 on public.profiles      to anon, authenticated;
grant update                 on public.profiles      to authenticated;
grant select                 on public.books         to anon, authenticated;
grant insert, update         on public.books         to authenticated;
grant select                 on public.book_copies   to anon, authenticated;
grant insert, update         on public.book_copies   to authenticated;
grant select                 on public.book_images   to anon, authenticated;
grant insert, update         on public.book_images   to authenticated;
grant select                 on public.book_reviews  to anon, authenticated;
grant insert, update         on public.book_reviews  to authenticated;
grant select, insert, update on public.book_requests to authenticated;
grant select                 on public.swaps         to authenticated;
grant select                 on public.swap_items    to authenticated;
grant select, update         on public.notifications to authenticated;
grant select, insert         on public.reports       to authenticated;
grant select                 on public.user_roles    to authenticated;
grant select                 on public.ownership_events to anon, authenticated;
grant select                 on public.audit_logs    to authenticated;
```

**Анхаарах гурван зүйл:**

1. `swaps` болон `swap_items` дээр **INSERT/UPDATE/DELETE огт байхгүй** → PostgREST-ээр шууд
   бичих зам физикээр байхгүй. Бүх өөрчлөлт RPC-ээр.
2. `user_roles` дээр **зөвхөн SELECT** → хэрэглэгч өөрийгөө admin болгож чадахгүй.
3. `ownership_events`, `audit_logs` дээр **зөвхөн SELECT** → түүх өөрчлөгдөхгүй.

### 4.3 Policy-ууд

```sql
-- ===== profiles =====
create policy profiles_select_public on public.profiles
  for select to anon, authenticated using (true);
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ===== books =====
create policy books_select_public on public.books
  for select to anon, authenticated
  using (moderation_status = 'active' or private.is_staff());
create policy books_insert_authenticated on public.books
  for insert to authenticated
  with check (created_by = (select auth.uid()) and private.is_active_account());
create policy books_update_creator on public.books
  for update to authenticated
  using      (created_by = (select auth.uid()) or private.is_staff())
  with check (created_by = (select auth.uid()) or private.is_staff());

-- ===== book_copies =====
create policy book_copies_select_public on public.book_copies
  for select to anon, authenticated
  using (moderation_status = 'active'
         or owner_id = (select auth.uid())
         or private.is_staff());
create policy book_copies_insert_own on public.book_copies
  for insert to authenticated
  with check (owner_id     = (select auth.uid())
          and custodian_id = (select auth.uid())
          and private.is_active_account());
create policy book_copies_update_own on public.book_copies
  for update to authenticated
  using      (owner_id = (select auth.uid()) or private.is_staff())
  with check (owner_id = (select auth.uid()) or private.is_staff());

-- ===== book_images =====
create policy book_images_select_public on public.book_images
  for select to anon, authenticated
  using (status = 'ready' or private.owns_copy(book_copy_id) or private.is_staff());
create policy book_images_insert_owner on public.book_images
  for insert to authenticated
  with check (private.owns_copy(book_copy_id)
          and uploaded_by = (select auth.uid())
          and private.is_active_account());
create policy book_images_update_owner on public.book_images
  for update to authenticated
  using      (private.owns_copy(book_copy_id) or private.is_staff())
  with check (private.owns_copy(book_copy_id) or private.is_staff());

-- ===== book_reviews =====
create policy book_reviews_select_public on public.book_reviews
  for select to anon, authenticated
  using (moderation_status = 'active'
         or user_id = (select auth.uid())
         or private.is_staff());
create policy book_reviews_insert_own on public.book_reviews
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_active_account());
create policy book_reviews_update_own on public.book_reviews
  for update to authenticated
  using      (user_id = (select auth.uid()) or private.is_staff())
  with check (user_id = (select auth.uid()) or private.is_staff());

-- ===== book_requests — ХУВИЙН. Зөвхөн эзэн нь харна. =====
create policy book_requests_select_own on public.book_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_staff());
create policy book_requests_insert_own on public.book_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_active_account());
create policy book_requests_update_own on public.book_requests
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ===== swaps / swap_items — ЗӨВХӨН ХАРАХ, бичих policy огт байхгүй =====
create policy swaps_select_participant on public.swaps
  for select to authenticated
  using ((select auth.uid()) in (requester_id, responder_id) or private.is_staff());
create policy swap_items_select_participant on public.swap_items
  for select to authenticated
  using (private.is_swap_participant(swap_id) or private.is_staff());

-- ===== notifications =====
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ===== reports =====
create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or private.is_staff());
create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()) and private.is_active_account());

-- ===== ownership_events — өмчлөлийн түүх нь community-ийн ИЛ ТОД БАЙДАЛ =====
create policy ownership_events_select on public.ownership_events
  for select to anon, authenticated using (true);

-- ===== audit_logs — зөвхөн ажилтан =====
create policy audit_logs_select_staff on public.audit_logs
  for select to authenticated using (private.is_staff());

-- ===== user_roles =====
create policy user_roles_select_self on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_staff());
```

> **`ownership_events` яагаад нийтэд нээлттэй вэ?** Энэ нь community-ийн итгэлцлийн үндэс —
> "энэ ном хэдэн хүний гарыг дамжсан бэ?" гэдэг нь номын хуудсанд харагдах ёстой мэдээлэл.
> Мөр нь зөвхөн `profile id` агуулна; email, утас байхгүй. Хэрэв хожим үүнийг хувийн болгох
> шаардлага гарвал `using (…)` нөхцөлийг өөрчлөх нь нэг мөрийн ажил.

---

## 5. Хувийн мэдээлэл хамгаалалт

**Email, утас, нууц үг нь `public` schema-д ОГТ БАЙХГҮЙ.** Тэдгээр нь `auth.users`-д үлдэнэ,
харин PostgREST нь `auth` schema-г **хэзээ ч** харуулдаггүй.

```
┌───────────────────────────────────────────────────────────┐
│ auth.users     email · phone · encrypted_password         │
│                ↑ PostgREST ЭНД ХҮРЭХГҮЙ                   │
└───────────────────────────────────────────────────────────┘
                        │
       ┌────────────────┼──────────────────┐
       │                                   │
  supabase.auth.getUser()          supabaseAdmin.auth.admin
  JWT-scoped — ЗӨВХӨН              .listUsers()
  дуудагчийнхыг буцаана             server-only + admin шалгалт
                                    + audit_logs('pii.read')
```

Үүний үр дүнд *"А нь Б-ийн email-ийг уншиж чадах уу?"* гэсэн асуулт нь **policy-гоор биш,
бүтцээрээ** үгүй болно — тэр өгөгдлийг агуулсан мөр ил гарсан schema-д огт байхгүй.

Хэрэв `profiles_private` гэсэн хоёр дахь table үүсгэсэн бол нэг буруу policy бичихэд задрах
байсан. Одоогийн загварт задрах policy гэж байхгүй.

---

## 6. Server Action / Route Handler-ийн дүрэм

Мутаци бүр яг энэ дарааллаар:

```ts
'use server'
import 'server-only'

export async function completeSwapAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  // 1. AUTHENTICATE — хуудасны шалгалт action руу ДАМЖИХГҮЙ
  const user = await requireUser()

  // 2. RATE LIMIT
  if (!(await checkRateLimit(`user:${user.id}`, 'swap.complete', 30, '1 hour')))
    return { ok: false, message: 'Хэт олон хүсэлт. Түр хүлээнэ үү.' }

  // 3. VALIDATE — зөвхөн ЛАВЛАГАА авна, объект биш.
  //    Сайн бүтэцтэй объект ч дуудагчид харьяалагдахгүй мөрийг заасан байж болно.
  const parsed = z.object({ swapId: z.uuid() }).safeParse({ swapId: fd.get('swapId') })
  if (!parsed.success) return { ok: false, errors: z.flattenError(parsed.error).fieldErrors }

  // 4. AUTHORIZE + MUTATE — atomic, DB дотор
  try { await completeSwap(parsed.data.swapId) }
  catch (e) { return toActionError(e) }   // түүхий алдаа зөвхөн лог руу

  // 5. Cache шинэчлэх
  updateTag(`swap:${parsed.data.swapId}`)

  // 6. Analytics — хариу илгээгдсэний ДАРАА, PII-гүй
  after(() => recordAnalytics('swap_completed', { swapId: parsed.data.swapId }))

  // 7. Буцаах утгыг ХЯЗГААРЛАХ — DB мөрийг бүтнээр нь буцаахгүй
  return { ok: true }
}
```

**Хатуу хориотой зүйлс:**

| Хориотой | Яагаад |
|---|---|
| `ownerId`, `userId`-г клиентээс авах | Халдагч өөр хүний ID илгээнэ. Үргэлж `auth.uid()` |
| DB мөрийг бүтнээр нь клиент рүү буцаах | Хэрэгцээгүй багана задарна (excessive data exposure) |
| `throw new Error(dbError.message)` | Postgres алдаа нь table/багана/constraint нэр агуулна |
| Хуудас дээр шалгасан тул action дотор шалгахгүй байх | Action бол тусдаа орох цэг |
| `getSession()` ашиглах | Cookie-г л уншдаг, хуурамчилж болно. `getUser()` ашиглана |

---

## 7. Файл байршуулалтын аюулгүй байдал

### 7.1 Урсгал

```
[1] Клиент файл сонгоно
    Клиент талын шалгалт (ЗӨВХӨН UX, итгэхгүй): төрөл, ≤5MB, 200–6000px, <8 ширхэг

[2] POST /api/uploads/book-image { bookCopyId, mimeType, byteSize, width, height }
    Route Handler:
      a. getUser() → байхгүй бол 401
      b. данс идэвхтэй эсэх → 403
      c. rate limit 30/цаг → 429
      d. ★ хуулбарыг DB-ЭЭС ДАХИН УНШИНА: owner_id = auth.uid()? → 403   ◄ IDOR хаалт
      e. энэ хуулбарын зургийн тоо < 8 → 409
      f. mimeType ∈ {jpeg, png, webp} → 415
      g. өргөтгөлийг MIME-ЭЭС гаргана, файлын нэрнээс ХЭЗЭЭ Ч биш
      h. хэмжээ 1KiB..5MiB → 413; хэмжигдэхүүн 200..6000 → 422
      i. image_id = crypto.randomUUID()
         objectKey = copies/<copyId>/<image_id>.<ext>
      j. book_images INSERT (status='pending') — ХЭРЭГЛЭГЧИЙН client-ээр,
         тиймээс RLS book_images_insert_owner мөн давах ёстой
      k. presigned PUT, TTL 300 сек, нөхцөл: яг тэр key, яг тэр Content-Type,
         яг тэр Content-Length

[3] Browser байтыг R2 руу ШУУД PUT хийнэ. Vercel-ээр дамжихгүй.

[4] confirmBookImageAction({ imageId }) — Server Action
      a. эзэмшлийг DB-ээс дахин унших
      b. storage.stat() → объект байгаа эсэх, бодит хэмжээ
      c. ★ storage.readHead(32) → MAGIC NUMBER шалгах:
           JPEG  FF D8 FF
           PNG   89 50 4E 47 0D 0A 1A 0A
           WebP  "RIFF"…"WEBP"
         зөрвөл → 'removed', R2 объект устгах, 400
      d. БОДИТ өргөн/өндрийг header-ээс уншиж, клиентийн мэдүүлснийг ДАРЖ БИЧНЭ
      e. status='ready'
      f. эхний зураг бол sort_order = 0 (үндсэн зураг)

[5] Цэвэрлэгч: status='pending' AND created_at < now()-'1 hour'
    → R2 объект устгах, 'removed' болгох

[6] Устгах: status='removed' (RLS шалгана), дараа нь after(() => storage.delete())
    DB мөр физикээр устахгүй — модератор юу байршуулсныг харах боломжтой
```

### 7.2 Шалгалт бүр хаана байгаа

| Шалгалт | Клиент | Route Handler | R2 presign | Confirm | DB |
|---|:--:|:--:|:--:|:--:|:--:|
| MIME цагаан жагсаалт | ✓ | ✓ | ✓ | ✓ | ✓ CHECK |
| Өргөтгөл MIME-тэй таарах | – | ✓ | – | ✓ | ✓ key regex |
| **Magic number** | – | – | – | **✓** | – |
| Хэмжээ 1KiB–5MiB | ✓ | ✓ | ✓ | ✓ | ✓ CHECK |
| Хэмжигдэхүүн 200–6000 | ✓ | ✓(мэдүүлсэн) | – | **✓(бодит)** | ✓ CHECK |
| ≤8 зураг | ✓ | ✓ | – | ✓ | ✓ trigger |
| **Дуудагч хуулбарыг эзэмших** | – | **✓ дахин унших** | – | ✓ | ✓ RLS |
| Данс идэвхтэй | – | ✓ | – | ✓ | ✓ RLS |
| Rate limit | – | ✓ | – | – | ✓ |
| Key-ийн хэлбэр (traversal хаах) | – | ✓ үүсгэсэн | ✓ яг key | – | ✓ CHECK regex |
| Signed URL хугацаа | – | ✓ 300с | ✓ | – | – |
| **SVG татгалзах** | ✓ | ✓ | ✓ | ✓ | ✓ |

> **SVG яагаад бүрэн хоригдсон бэ:** SVG нь `<script>` агуулж болох XML — хэрэглэгчийн
> байршуулсан SVG нь **хадгалагдсан XSS**. `next.config.ts` дээр `dangerouslyAllowSVG` нь
> `false` хэвээр.

> **Magic number шалгалт яагаад upload-ийн ДАРАА вэ:** presigned PUT-ийн үед сервер байтыг огт
> хардаггүй. 32 байтын ranged GET нь ~1 R2 class-B үйлдэл зарцуулах бөгөөд клиентийн хяналтад
> байгаа контентыг шалгах цорын ганц шударга арга.

### 7.3 Object key схем

```
copies/{book_copy_id}/{image_id}.{ext}     жишээ: copies/8f3c…/2a91….webp
avatars/{user_id}.{ext}
```

- `image_id` нь **серверийн үүсгэсэн UUID v4**. Хэрэглэгчийн файлын нэр хаана ч гарахгүй —
  хадгалагдахгүй, логлогдохгүй, `Content-Disposition`-д ч орохгүй.
- DB-ийн regex CHECK нь хэлбэрийг албадана — апп эвдэрсэн ч traversal хэлбэрийн key бүртгэгдэхгүй.
- Key нь **өөрчлөгддөггүй**: зураг солиход **шинэ** key бичигдэнэ. Тиймээс cache
  invalidation хэрэггүй ба урсгал бүхэлдээ idempotent.

---

## 8. Rate limiting

Хязгаарлагдсан үйлдэл бүр **`created_at` болон эзэнтэй мөр үүсгэдэг**. Тиймээс хязгаар нь
"миний сүүлийн N хугацаанд үүсгэсэн мөрийн тоо" гэсэн тоолох query — тусдаа table, TTL цэвэрлэгч,
Redis хэрэггүй.

```sql
create or replace function private.rate_limit_ok(
  p_table text, p_max int, p_window interval)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare v_count int;
begin
  execute format(
    'select count(*) from public.%I where %I = $1 and created_at > now() - $2',
    p_table,
    case p_table when 'book_copies' then 'owner_id'
                 when 'reports'     then 'reporter_id'
                 else 'user_id' end)
  into v_count using (select auth.uid()), p_window;
  return v_count < p_max;
end $$;
```

RLS-ийн `WITH CHECK` дотроос дуудагдана — тиймээс **PostgREST-ээр шууд дуудсан ч тойрч чадахгүй**.

| Үйлдэл | Хязгаар | Хаана |
|---|---|---|
| Нэвтрэх / бүртгүүлэх | 1 мин / 10 IP | Cloudflare + Supabase Auth + Turnstile |
| Нууц үг сэргээх | 1 цаг / 5 IP | Cloudflare + Supabase Auth |
| Ном нэмэх | 24 цаг / 30 | `rate_limit_ok('book_copies', 30, '24 hours')` |
| Swap хүсэх | 24 цаг / 20 | `rate_limit_ok('swaps', 20, '24 hours')` |
| Сэтгэгдэл | 1 цаг / 10 | `rate_limit_ok('book_reviews', 10, '1 hour')` |
| Гомдол | 1 цаг / 10 | `rate_limit_ok('reports', 10, '1 hour')` |
| Зураг presign | 1 цаг / 30 | Route Handler + `book_images` тоолол |

**Хязгаарлалт:** мөр үүсгэдэггүй үйлдэл (хайлт, зураг үзэх) нь зөвхөн Cloudflare түвшинд
хязгаарлагдана.

---

## 9. OWASP хяналтын жагсаалт

| Заналхийлэл | Энэ төсөл дээрх хамгаалалт |
|---|---|
| **Broken access control / IDOR** | RLS нь мөр бүрд. `/books/124` гэж URL солиход RLS хамгаалагдсан мөрийг **буцаахгүй**. Бүх ID нь UUID тул тааж болохгүй. Server Action бүр DB-ээс дахин уншиж эзэмшлийг шалгана. |
| **SQL injection** | Supabase client нь параметрчилсэн query үүсгэнэ. Түүхий SQL бичихгүй. `rate_limit_ok`-ийн `format(%I)` нь identifier-ийг зөв escape хийнэ. |
| **XSS** | React нь анхдагчаар escape хийнэ. `dangerouslySetInnerHTML` **хориотой** (ESLint дүрэм). `ts_headline` ашиглахгүй. SVG upload хориотой. CSP nonce `proxy.ts`-ээс. |
| **CSRF** | Server Action нь Origin/Host харьцуулалт хийнэ, зөвхөн POST. Supabase cookie нь `SameSite=Lax`, `HttpOnly`, `Secure`. |
| **Brute force** | Turnstile + Cloudflare rate rule + Supabase Auth-ийн дотоод IP хязгаар. |
| **Spam** | `rate_limit_ok` RLS дотор; `reports_one_open_per_target` unique index; `book_reviews` unique. |
| **Хортой файл** | §7 — magic number, MIME, хэмжээ, хэмжигдэхүүн, SVG хориг, UUID key. |
| **Excessive data exposure** | DTO давхарга — DB мөр шууд буцахгүй. `book_requests` нь эзэндээ л харагдана. Email нь `public` schema-д огт байхгүй. |
| **Privilege escalation** | `user_roles` дээр INSERT/UPDATE grant огт байхгүй. Role нь `profiles`-д БИШ. |
| **Session hijacking** | `getUser()` нь token-ыг Supabase дээр баталгаажуулна. Cookie `HttpOnly` + `Secure`. |
| **Түүх дахин бичих** | `solio_deny_mutation` trigger — `postgres` role-оор ч боломжгүй. |

---

## 10. Нууцлалын хадгалалтын дүрэм

| Дүрэм | Тайлбар |
|---|---|
| `NEXT_PUBLIC_` угтвартай бүх зүйл browser-т очно | Next.js үүнийг bundle-д шууд оруулна |
| `SUPABASE_SERVICE_ROLE_KEY` нь зөвхөн `src/lib/supabase/admin.ts`-д | Тэр файл `import 'server-only'`-оор эхэлнэ |
| `process.env`-д зөвхөн `src/lib/validation/env.ts` хүрнэ | Секрет аппын бусад хэсэгт тархахгүй |
| `.env.local` нь `.gitignore`-д | `.env*` хэв маяг аль хэдийн байгаа |
| Секрет лог, алдаа, analytics руу орохгүй | Sentry `beforeSend` нь `email`, `phone`, `sb-*` cookie-г устгана |
| Секрет chat, screenshot руу орохгүй | Хэрэглэгч өөрөө `.env.local`-д оруулна |

---

## 11. Production-ы өмнөх аудитын жагсаалт

Brief §66-ийн асуулт бүр. **Аль нэг нь "тийм" бол production-д гаргах боломжгүй.**

| # | Асуулт | Хариулт | Механизм | Хэмжсэн үр дүн |
|---|---|:--:|---|---|
| 1 | А нь Б-ийн email-ийг харж чадах уу? | **Үгүй** | `auth` schema PostgREST-д ил гараагүй; `public`-д email/phone багана **0 ширхэг** | ✅ `permission denied (42501)`; `public_columns_containing_email = 0` |
| 2 | А нь Б-ийн номыг засаж чадах уу? | **Үгүй** | `R:book_copies_update_own` | ✅ `UPDATE 0` — мөр огт харагдаагүй |
| 3 | А нь Б-ийн номыг өөрийн болгож чадах уу? | **Үгүй** | RLS + `T:book_copies_guard` | ✅ 0 мөр өөрчлөгдсөн |
| 4 | А нь Б-ийн swap-ийг харж чадах уу? | **Үгүй** | `R:swaps_select_participant` | ✅ `visible_swaps = 0`, `visible_swap_items = 0` |
| 5 | А нь хуурамч өмчлөлийн түүх үүсгэж чадах уу? | **Үгүй** | GRANT байхгүй + trigger | ✅ `permission denied for table ownership_events (42501)` |
| 6 | А нь Б-ийн wishlist-ийг харж чадах уу? | **Үгүй** | `R:book_requests_select_own` | ✅ `mallory_sees_requests = 0` |
| 7 | А нь Б-ийн мэдэгдлийг харж чадах уу? | **Үгүй** | `R:notifications_select_own` | ✅ `mallory_sees_notifications = 0` |
| 8 | Admin биш хүн audit log уншиж чадах уу? | **Үгүй** | `R:audit_logs_select_staff` | ✅ `mallory_sees_audit = 0` |
| 9 | А нь өөрийгөө admin болгож чадах уу? | **Үгүй** | `user_roles`-д INSERT grant байхгүй | ✅ `permission denied for table user_roles (42501)` |
| 10 | А нь swap-ийг шууд UPDATE хийж чадах уу? | **Үгүй** | GRANT байхгүй | ✅ `permission denied for table swaps (42501)` |
| 11 | А нь Б-ийн swap-ийг дуусгаж чадах уу? | **Үгүй** | `F:complete_swap` оролцогч шалгалт | ✅ `NOT_A_PARTICIPANT (42501)` |
| 12 | Нэг хүн дангаараа swap дуусгаж чадах уу? | **Үгүй** | `confirmed_by <> actor` | ✅ `AWAITING_COUNTERPARTY_CONFIRMATION` |
| 13 | Давхар өмчлөл шилжүүлэг боломжтой юу? | **Үгүй** | unique index + terminal guard | ✅ `INVALID_TRANSITION_COMPLETED_TO_COMPLETED` |
| 14 | Дууссан гүйлгээг чимээгүй дахин бичиж болох уу? | **Үгүй** | `T:solio_deny_mutation` | ✅ `TABLE_IS_APPEND_ONLY` (`postgres` role-оор ч — UPDATE-д гарц байхгүй) |
| 14б | Хэрэглэгч түүхийн мөр устгаж чадах уу? | **Үгүй** | `T:solio_deny_mutation` + GRANT байхгүй | ✅ `authenticated`, `service_role` хоёулаа таслагдана ([database.md §6.1](./database.md)) |
| 15 | Буруу swap шилжилт боломжтой юу? | **Үгүй** | `T:swaps_guard` ирмэгийн цагаан жагсаалт | ✅ 6 ирмэгээс бусад бүгд таслагдана |
| 16 | А нь Б-ийн зургийг устгаж чадах уу? | **Үгүй** | `R:book_images_update_owner` + `F:owns_copy` | ⏳ Phase 2-т тест бичигдэнэ |
| 17 | Admin биш хүн admin endpoint-д хүрч чадах уу? | **Үгүй** | `requireRole()` + RPC доторх `has_role()` | ⏳ Phase 5-т тест бичигдэнэ |
| 18 | UI-г тойрч API-г шууд дуудаж болох уу? | **Болно, гэхдээ ашиггүй** | RLS/GRANT нь UI-аас хамааралгүй | ✅ №2,4,5,9,10-аар батлагдсан |

**Тестийн орчин:** PostgreSQL 17, локал Supabase stack, `authenticated` role, JWT claim нь
халдагчийн ID-д тавигдсан. Эдгээр нь `supabase/tests/security/*.test.sql` (pgTAP) болж
хөрвүүлэгдэн CI-д ажиллана.

⏳ тэмдэгтэй хоёр зүйл нь тухайн feature хэрэгжсэний дараа тестлэгдэнэ — Phase 2 болон Phase 5-ийн
дуусах нөхцөлд орсон ([roadmap.md](./roadmap.md)).
