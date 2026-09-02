# Solio — Хэрэгжүүлэлтийн замын зураг

> MVP-ийн дуусах нөхцөл (Definition of Done), Phase 1–7-ийн дэлгэрэнгүй ажлын жагсаалт,
> болон өөрчлөлт бүрийн тайлагналын загвар.
> Холбоотой: [architecture.md](./architecture.md) · [setup.md](./setup.md) ·
> [database.md](./database.md)

---

## 1. MVP-ийн дуусах нөхцөл (Definition of Done)

### Хэрэглэгч
- [ ] Бүртгүүлэх (email + нууц үг, Turnstile)
- [ ] Email баталгаажуулах
- [ ] Нэвтрэх / гарах
- [ ] Нууц үг сэргээх
- [ ] Session удирдлага (`proxy.ts`-ээр сэргээх)
- [ ] Нийтийн профайл үзэх (`/u/{username}`)
- [ ] Өөрийн профайл засах

### Ном
- [ ] Ном нэмэх (ISBN сонголттой, гараар оруулах боломжтой)
- [ ] Зураг байршуулах (preview, дараалал солих, устгах, үндсэн зураг сонгох)
- [ ] Өөрийн номоо засах
- [ ] Өөрийн номоо идэвхгүй болгох (устгахгүй)
- [ ] Номын дэлгэрэнгүй хуудас
- [ ] Ном хайх
- [ ] Шүүх (нөхцөл, хэл, зөвхөн боломжтой)

### Нээлт (Discovery)
- [ ] Нүүр хуудас: хайлтын мөр
- [ ] "Шинээр нэмэгдсэн" (Recently Added)
- [ ] "Түгээмэл" (Popular)
- [ ] "Танд санал болгох" (Recommended For You) + cold-start fallback
- [ ] Бүх жагсаалтад pagination

### Wishlist
- [ ] Хүссэн номын хүсэлт үүсгэх
- [ ] Өөрийн хүсэлтүүдийг харах
- [ ] Хүсэлт устгах/цуцлах
- [ ] Тохирох ном нэмэгдэхэд мэдэгдэл

### Swap
- [ ] Ном санал болгож солилцоо хүсэх
- [ ] Хүлээн авах (accept)
- [ ] Татгалзах (reject)
- [ ] Цуцлах (cancel)
- [ ] Баталгаажуулах (confirm) → Дуусгах (complete)
- [ ] Солилцооны түүх харах

### Итгэлцэл (Trust)
- [ ] Номын үнэлгээ/сэтгэгдэл (1–5, нэг хэрэглэгч нэг ном)
- [ ] Гомдол мэдүүлэх (report)
- [ ] Өмчлөлийн түүх харах
- [ ] Солилцооны түүх
- [ ] Audit event бүртгэгдэх

### Мэдэгдэл
- [ ] Swap хүсэлт ирсэн
- [ ] Swap хүлээн авагдсан
- [ ] Swap дууссан
- [ ] Wishlist тохирол

### Админ
- [ ] Хэрэглэгчид харах / түдгэлзүүлэх
- [ ] Ном, хуулбар харах / нуух
- [ ] Гомдлын дараалал, шийдвэрлэх
- [ ] Сэтгэгдэл модерацлах
- [ ] Solилцоо шалгах
- [ ] Өмчлөлийн түүх шалгах
- [ ] Audit log харах

### Тогтолцоо
- [ ] Mobile responsive
- [ ] SEO: номын хуудас индексжинэ + Open Graph
- [ ] Хувийн хуудсууд индексжихгүй
- [ ] Тест (unit / integration / security)
- [ ] README, setup guide, `.env.example`
- [ ] Migration-ууд git-д
- [ ] Seed script

---

## 2. Phase 1 — Дэд бүтэц

**Урьдчилсан нөхцөл:** Supabase project ✅, Supabase CLI ✅, Docker ✅, GitHub repo ✅
**Mock-оор үргэлжлүүлж болох:** R2 (LocalDevelopmentStorage), Turnstile (хоосон = идэвхгүй)
**Хугацааны төсөөлөл:** 3–4 өдөр

| # | Ажил | Файлууд | Migration | Env | Хүлээн авах шалгуур |
|---|---|---|---|---|---|
| 1.1 | Tailwind хасах, CSS Modules суурь | `package.json`, `postcss.config.mjs`(устгана), `app/globals.css`, `app/page.tsx` | – | – | `npm run build` амжилттай, Tailwind class үлдээгүй |
| 1.2 | `app/` → `src/app/`, `tsconfig` paths | `src/app/**`, `tsconfig.json` | – | – | `npm run dev` ажиллана, `@/` import зөв |
| 1.3 | Dependency нэмэх | `package.json` | – | – | `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `@aws-sdk/client-s3`, `vitest` |
| 1.4 | Env validation | `src/lib/validation/env.ts` | – | бүгд | Хувьсагч дутуу бол **нэрлэсэн** алдаа өгнө |
| 1.5 | Supabase client-ууд | `src/lib/supabase/{client,server,admin,proxy}.ts` | – | – | `admin.ts` нь `import 'server-only'`-той |
| 1.6 | `proxy.ts` session сэргээх | `src/proxy.ts` | – | – | Refresh хийхэд session хадгалагдана |
| 1.7 | Migration 0001–0003 (bootstrap, domain, функц) | `supabase/migrations/` | ✅ | – | `supabase db reset` цэвэр ажиллана |
| 1.8 | DAL + permission давхарга | `src/lib/auth/dal.ts`, `src/lib/permissions/require.ts` | – | – | `requireUser()`, `requireRole()` ажиллана |
| 1.9 | Алдаа боловсруулалт | `src/lib/errors.ts`, `src/app/{error,not-found,forbidden,unauthorized}.tsx` | – | – | DB алдаа browser-т задрахгүй |
| 1.10 | ESLint давхаргын дүрэм | `eslint.config.mjs` | – | – | `components/`-оос `service.ts` импортлоход алдаа |
| 1.11 | Storage abstraction | `src/lib/storage/{ports,r2,local,index}.ts` | – | R2_* | Credential хоосон → local; production-д боот татгалзана |
| 1.12 | Vitest + pgTAP суурь | `vitest.config.ts`, `supabase/tests/` | – | – | `npm run test`, `supabase test db` ажиллана |

---

## 3. Phase 2 — Үндсэн өгөгдөл

**Урьдчилсан нөхцөл:** Phase 1
**Хугацааны төсөөлөл:** 5–7 өдөр

| # | Ажил | Файлууд | Migration | Хүлээн авах шалгуур |
|---|---|---|---|---|
| 2.1 | `profiles` + `user_roles` + signup trigger | `src/features/users/**` | 0010, 0011 | Бүртгүүлэхэд профайл автоматаар үүснэ |
| 2.2 | Auth UI (register/login/reset/verify) | `src/app/(auth)/**` | – | Mailpit дээр email ирнэ, баталгаажуулалт ажиллана |
| 2.3 | Профайл харах/засах | `src/app/u/[username]/`, `src/app/profile/` | – | Өөр хүний профайл дээр email харагдахгүй |
| 2.4 | `books` + `book_copies` + guard trigger | `src/features/books/**` | 0020, 0030 | Ном нэмэх RPC ажиллана |
| 2.5 | `book_images` + R2 presign урсгал | `src/features/images/**`, `src/app/api/uploads/book-image/route.ts` | 0031 | Magic number шалгалт хуурамч файлыг таслана |
| 2.6 | Ном нэмэх UI (зураг preview, дараалал) | `src/app/books/new/` | – | 8-аас олон зураг татгалзана |
| 2.7 | Номын дэлгэрэнгүй хуудас + SEO | `src/app/books/[id]/`, `opengraph-image.tsx` | – | Open Graph tag зөв, эзний email харагдахгүй |
| 2.8 | `book_reviews` | `src/features/reviews/**` | 0040 | Давхар review `23505` өгнө |
| 2.9 | `book_requests` (wishlist) + matcher | `src/features/wishlist/**` | 0041 | Тохирох ном нэмэхэд мэдэгдэл үүснэ |
| 2.10 | RLS policy бүрэн багц | migration | 0090 | **§11-ийн тест 1–9 давна** |
| 2.11 | Seed data | `supabase/seed.sql` | – | `db reset` дараа 20 ном, 6 хэрэглэгч |

**⏳ Аюулгүй байдлын тест №16** (өөр хүний зураг устгах) энд бичигдэнэ.

---

## 4. Phase 3 — Swap

**Урьдчилсан нөхцөл:** Phase 2
**Хугацааны төсөөлөл:** 4–5 өдөр

| # | Ажил | Файлууд | Migration | Хүлээн авах шалгуур |
|---|---|---|---|---|
| 3.1 | `swaps` + `swap_items` + `swaps_guard` | – | 0050 | Буруу шилжилт `23514` өгнө |
| 3.2 | `ownership_events` + immutability | – | 0051, 0070 | UPDATE/DELETE `postgres`-оор ч таслагдана |
| 3.3 | `audit_logs` + `emit_event()` | – | 0060 | Мэдэгдэл ба audit нэг transaction-д |
| 3.4 | `request_swap()` RPC | `src/features/swaps/service.ts` | 0052 | Өөрийн номыг өөртөө санал болгож болохгүй |
| 3.5 | `respond_to_swap()` RPC (accept/reject/cancel) | – | 0053 | Accept дээр хуулбарууд `reserved` болно |
| 3.6 | **`complete_swap()` RPC** | – | 0054 | **§8-ийн тест A–G давна** |
| 3.7 | Swap UI (жагсаалт, дэлгэрэнгүй, товчнууд) | `src/app/swaps/**` | – | Төлөв бүрд зөв товч харагдана |
| 3.8 | Мэдэгдлийн UI | `src/app/notifications/` | – | Уншаагүй тоолуур зөв |

---

## 5. Phase 4 — Нээлт

**Урьдчилсан нөхцөл:** Phase 2 (Phase 3-тай зэрэг явж болно)
**Хугацааны төсөөлөл:** 3–4 өдөр

| # | Ажил | Файлууд | Migration | Хүлээн авах шалгуур |
|---|---|---|---|---|
| 4.1 | Хайлтын index + `search_books()` | `src/features/search/**` | 0080 | `ном` → *Номын сан*, *Ном унших* олдоно |
| 4.2 | Хайлтын UI + шүүлтүүр | `src/app/search/` | – | Үсгийн алдаатай хайлт ажиллана |
| 4.3 | `books_feed()` keyset pagination | `src/lib/db/cursor.ts` | 0081 | Хуудас солиход мөр давхардахгүй |
| 4.4 | Recommendation модуль | `src/features/recommendations/**` | – | Шинэ хэрэглэгчид fallback гарна |
| 4.5 | Нүүр хуудас (3 rail) | `src/app/page.tsx` | – | Нэг query-ээр бүх мөрийг татахгүй |
| 4.6 | `robots.ts`, `sitemap.ts` | `src/app/` | – | `/profile`, `/swaps` индексжихгүй |

---

## 6. Phase 5 — Итгэлцэл ба модерац

**Урьдчилсан нөхцөл:** Phase 3
**Хугацааны төсөөлөл:** 3–4 өдөр

| # | Ажил | Файлууд | Migration | Хүлээн авах шалгуур |
|---|---|---|---|---|
| 5.1 | `reports` + гомдол мэдүүлэх UI | `src/features/reports/**` | 0061 | Давхар гомдол таслагдана |
| 5.2 | Админ layout + role gate | `src/app/(admin)/**` | – | **Тест №17 давна** |
| 5.3 | Админ: хэрэглэгч, ном, хуулбар | `src/app/(admin)/admin/**` | – | Үйлдэл бүр audit-д бичигдэнэ |
| 5.4 | Админ: гомдол, сэтгэгдэл модерац | – | 0062 | `moderate_entity()` RPC |
| 5.5 | Админ: swap, өмчлөл, audit log | – | – | Өмчлөлийн гинж бүтнээр харагдана |
| 5.6 | `admin_correct_ownership()` | – | 0063 | Шалтгаан заавал, audit-д орно |
| 5.7 | Rate limiting (`rate_limit_ok`) | – | 0064 | PostgREST-ээр шууд дуудсан ч ажиллана |
| 5.8 | Turnstile интеграц | `src/features/users/actions.ts` | – | Серверийн талд token шалгагдана |

---

## 7. Phase 6 — Тест

**Хугацааны төсөөлөл:** 3–4 өдөр

| # | Ажил | Файлууд |
|---|---|---|
| 6.1 | Unit: swap state machine (30 хосыг бүгдийг) | `src/tests/unit/swap-state.test.ts` |
| 6.2 | Unit: permission шалгалт | `src/tests/unit/permissions.test.ts` |
| 6.3 | Unit: book status шилжилт | `src/tests/unit/copy-state.test.ts` |
| 6.4 | Unit: Zod validation | `src/tests/unit/validation.test.ts` |
| 6.5 | Unit: recommendation ranking | `src/tests/unit/scoring.test.ts` |
| 6.6 | Unit: хайлтын нормчлол (монгол) | `src/tests/unit/search-norm.test.ts` |
| 6.7 | Integration: ном үүсгэх | `src/tests/integration/create-book.test.ts` |
| 6.8 | Integration: swap request → accept → complete | `src/tests/integration/swap-flow.test.ts` |
| 6.9 | Integration: ownership event үүсэх | `src/tests/integration/ownership.test.ts` |
| 6.10 | Security (pgTAP): §11-ийн 18 асуулт бүгд | `supabase/tests/security/*.test.sql` |
| 6.11 | pgTAP: state machine 30 хос | `supabase/tests/swap_transitions.test.sql` |
| 6.12 | pgTAP: immutability | `supabase/tests/immutability.test.sql` |
| 6.13 | pgTAP: DOMAIN утга = TS константа | `supabase/tests/domains.test.sql` |
| 6.14 | CI: бүрэн бүтэн байдлын query | `.github/workflows/ci.yml` |

---

## 8. Phase 7 — Deploy

**Урьдчилсан нөхцөл:** Phase 1–6, Cloudflare + R2 + домэйн + Vercel
**Хугацааны төсөөлөл:** 1–2 өдөр

| # | Ажил | Хүлээн авах шалгуур |
|---|---|---|
| 7.1 | `supabase db push` → production | Schema тэнцүү |
| 7.2 | Vercel env (3 орчинд) | Апп боот хийнэ |
| 7.3 | R2 bucket + custom domain + CORS | Зураг ачаалагдана |
| 7.4 | Cloudflare DNS + SSL Full(strict) + WAF | HTTPS ажиллана |
| 7.5 | Supabase Auth redirect URL шинэчлэх | Email баталгаажуулалт ажиллана |
| 7.6 | Smoke test | Бүртгүүлэх → ном нэмэх → swap → дуусгах |
| 7.7 | **Аюулгүй байдлын аудит бүрэн** | §11-ийн 18 асуулт бүгд "Үгүй" |

> ⚠️ §11-ийн аль нэг асуулт "Тийм" бол **production-д гаргахгүй**.

---

## 9. Нийт хугацааны төсөөлөл

| Phase | Ажлын өдөр (1 хөгжүүлэгч) |
|---|---|
| Phase 1 — Дэд бүтэц | 3–4 |
| Phase 2 — Үндсэн өгөгдөл | 5–7 |
| Phase 3 — Swap | 4–5 |
| Phase 4 — Нээлт | 3–4 |
| Phase 5 — Итгэлцэл/модерац | 3–4 |
| Phase 6 — Тест | 3–4 |
| Phase 7 — Deploy | 1–2 |
| **Нийт** | **22–30 ажлын өдөр** |

Phase 4 нь Phase 3-тай зэрэг явж болно (хамаарал байхгүй).

---

## 10. Хамаарал ба mock-оор ажиллах боломж

| Гадаад үйлчилгээ | Хэзээ ЗААВАЛ хэрэгтэй | Түүнгүйгээр юу хийж болох |
|---|---|---|
| Supabase (локал) | Phase 1-ээс | – (заавал) |
| Supabase (cloud) | Phase 7 | Бүх хөгжүүлэлт локал дээр |
| **Cloudflare R2** | **Phase 7** | Phase 1–6 бүхэлдээ `LocalDevelopmentStorage`-оор |
| Turnstile | Phase 5.8 | Хоосон key = идэвхгүй, урсгал ажиллана |
| Домэйн | Phase 7 | `localhost` дээр бүгд ажиллана |
| Vercel | Phase 7 | – |
| Sentry | Хэзээ ч заавал биш | Бүтэцлэгдсэн console лог |

---

## 11. Өөрчлөлт бүрийн тайлагналын загвар

Том өөрчлөлт бүрийн **өмнө** дараах хураангуйг гаргана (brief §58):

```
WHAT:
  Юу нэмэгдэж/өөрчлөгдөж байгаа — 1-2 өгүүлбэр.

WHY:
  Ямар шаардлагыг хангаж байгаа, яагаад яг ийм арга.

FILES:
  Үүсэх/өөрчлөгдөх файлуудын жагсаалт.

DATABASE CHANGES:
  Migration файл, table/багана/policy/функцийн өөрчлөлт.
  Устгах өөрчлөлт эсэхийг тодорхой заана.

NEW ENV VARS:
  Шинэ хувьсагч, public/secret, хаанаас авах.
  Байхгүй бол "none".

SECURITY IMPACT:
  Ямар шинэ хандалтын зам нээгдэж байна, түүнийг хаана хаасан.
  Аюулгүй байдлын аудитын аль асуултад нөлөөлж байна.

FUTURE IMPACT:
  Ирээдүйн feature-тэй хэрхэн нийцэж байгаа.
  Устгах migration шаардах эрсдэл байгаа эсэх.
```

**Жишээ:**

```
WHAT:
  Swap completion workflow нэмлээ.

WHY:
  Өмчлөл шилжүүлэхийг atomic transaction болгож, түүхийг бүрэн хадгалах.

FILES:
  src/features/swaps/{actions,service,state-machine,errors}.ts
  src/app/swaps/[id]/page.tsx

DATABASE CHANGES:
  0054_complete_swap.sql — public.complete_swap(uuid) SECURITY DEFINER функц.
  Устгах өөрчлөлт БИШ.

NEW ENV VARS:
  none

SECURITY IMPACT:
  book_copies.owner_id-г бичдэг цорын ганц зам. Оролцогч биш хүн таслагдана
  (тест 11); нэг хүн дангаараа дуусгаж чадахгүй (тест 12).

FUTURE IMPACT:
  custodian_id-г мөр нөхцөлтэй болгоход cafe custody-тай нийцнэ. Устгах
  migration шаардахгүй.
```
