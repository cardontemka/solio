# Solio — Тохиргооны заавар

> Энэ бол **танд** зориулсан алхам алхмын заавар. Гадаад үйлчилгээний бүх credential-ийг та
> өөрөө тохируулна.
>
> 🚫 **Key/нууц үгээ chat руу хэзээ ч бүү бич.** Заавар бүр "энэ утгыг хуулж аваад `.env.local`
> файлын ЭНЭ хувьсагчид өөрөө оруул" гэж хэлнэ.

---

## 0. Төлбөр шаардах эсэх — урьдчилсан анхааруулга

| Алхам | Үнэгүй юу | Карт шаардах уу |
|---|---|---|
| STEP 1 — GitHub | ✅ Үнэгүй (private repo ч үнэгүй) | ❌ |
| STEP 2 — Supabase | ✅ Free tier (500MB DB, 50k идэвхтэй хэрэглэгч) | ❌ |
| STEP 3 — Supabase CLI + Docker | ✅ Үнэгүй | ❌ |
| STEP 4 — Cloudflare (DNS, WAF, Turnstile) | ✅ Free plan | ❌ |
| **STEP 5 — Cloudflare R2** | ✅ Сард 10GB storage үнэгүй | ⚠️ **ТИЙМ** — баталгаажуулалтад карт хэрэгтэй |
| STEP 6 — Vercel | ✅ Hobby tier | ❌ (арилжааны хэрэглээнд Pro шаардана) |
| STEP 7 — Домэйн нэр | ❌ Жилд ~$10–15 | ⚠️ ТИЙМ |
| STEP 8 — Sentry (сонголт) | ✅ Free tier (сард 5k алдаа) | ❌ |

> **R2 болон домэйнгүйгээр хөгжүүлэлт бүрэн үргэлжилнэ.** R2 credential хоосон байвал апп
> автоматаар `LocalDevelopmentStorage`-д шилжиж, зургийг `public/uploads/` дор хадгална.
> Энэ fallback нь production-д **ажиллахаас татгалзана** — сервер эхлэхгүй бөгөөд ямар хувьсагч
> дутуу байгааг тодорхой хэлнэ.

---

## STEP 1 — GitHub

1. https://github.com/new руу ор.
2. **Repository name:** `solio`
3. **Private** сонго.
4. "Add a README", ".gitignore", "license" — **бүгдийг хоосон орхи** (repo дээр аль хэдийн файл байгаа).
5. **Create repository** дар.
6. Гарч ирсэн хуудсан дээрх командыг ажиллуул:

```bash
git remote add origin https://github.com/<чиний-нэр>/solio.git
git branch -M main
git push -u origin main
```

7. Branch стратеги:

```
main        ← production. Зөвхөн PR-ээр нэгддэг.
dev         ← integration branch.
feature/*   ← ажлын branch, жишээ: feature/swap-completion
```

8. **`.gitignore`-д `.env*` байгаа эсэхийг шалга** — байгаа. Энэ нь `.env.local`-ыг git-д
   орохоос сэргийлнэ. `.env.example` нь харин **зориудаар** commit хийгддэг (жинхэнэ утга агуулахгүй).

---

## STEP 2 — Supabase project

### 2.1 Project үүсгэх

1. https://supabase.com/dashboard руу ор → **Sign in with GitHub**.
2. **New project** дар.
3. **Name:** `solio`
4. **Database Password:** хүчтэй нууц үг үүсгэ.
   ⚠️ **Энийг password manager-т ЗААВАЛ хадгал** — дахин харагдахгүй.
5. **Region:** `Northeast Asia (Tokyo)` эсвэл `Southeast Asia (Singapore)` — Монголд хамгийн ойр.
6. **Create new project** → 2–3 минут хүлээнэ.

### 2.2 Key-үүдийг авах

1. Зүүн доод буланд **Project Settings** (араа icon) → **API**.
2. Дараах гурвыг хуулж ав:

| Dashboard дээрх нэр | Нууц уу | `.env.local`-д ямар нэрээр |
|---|---|---|
| **Project URL** | Нууц биш | `NEXT_PUBLIC_SUPABASE_URL` |
| **Publishable key** (эсвэл **anon public**) | Нууц биш — browser-т явна | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **Secret key** (эсвэл **service_role**) | 🔴 **МАШ НУУЦ** | `SUPABASE_SERVICE_ROLE_KEY` |

> **Supabase key-ийн нэршил өөрчлөгдсөн.** Шинэ project-ууд дээр `sb_publishable_…` ба
> `sb_secret_…` гэж харагдана; хуучин project-ууд дээр `anon` ба `service_role` (JWT хэлбэртэй).
> Хоёулаа ажиллана — dashboard дээр аль нь харагдаж байгааг нь ав.

> 🔴 **`service_role` / Secret key нь Row Level Security-г БҮРЭН тойрдог.** Хэрэв энэ задарвал
> database дэх бүх мөр уншигдаж, бичигдэх боломжтой болно. Үүнийг:
> - `NEXT_PUBLIC_` угтвартай **хэзээ ч** бүү тавь
> - Клиентийн код руу **хэзээ ч** бүү импортол
> - Chat, screenshot, лог руу **хэзээ ч** бүү оруул

### 2.3 Reference ID авах

**Project Settings → General → Reference ID** (жишээ: `abcdefghijklmnop`).
Энэ нь нууц биш — `supabase link`-д ашиглана. `.env.local`-д `SUPABASE_PROJECT_REF` гэж хадгал.

### 2.4 Auth тохиргоо

1. **Authentication → Providers → Email**:
   - **Enable Email provider** — асаалттай эсэхийг шалга
   - **Confirm email** — ✅ **АСАА** (brief §20 email verification шаардсан)
2. **Authentication → URL Configuration**:
   - **Site URL:** production-ын хаяг (жишээ `https://solio-alpha.vercel.app`, домэйн
     амьдарсны дараа `https://solio.mn`). Энэ нь зөвшөөрөгдөөгүй redirect бүрийн
     **нөөц хаяг** болдог тул буруу байвал хүн огт өөр сайт дээр очно.
   - **Redirect URLs** — хаяг бүрийг **`/**` төгсгөлтэй** нэм:
     ```
     http://localhost:3000/**
     https://solio.mn/**
     https://www.solio.mn/**
     https://solio-alpha.vercel.app/**
     ```
   ⚠️ **Яг таарах бичлэг (`…/api/auth/callback`) битгий ашигла.** GoTrue энэ
   жагсаалтыг query string-тэй нь хамт тааруулдаг: `?next=/my-books` гэсэн нэг
   параметр нэмэгдэхэд таарахаа болиод, кодыг Site URL руу явуулна. Тэгэхээр
   PKCE verifier cookie нэг хаяг дээр, код нөгөө хаяг дээр очиж
   "Баталгаажуулах холбоосын хугацаа дууссан" гэсэн алдаа **байнга** гарна.
   Апп өөрөө одоо redirect дээрээ query дамжуулдаггүй ([oauthNext.ts](../src/features/users/oauthNext.ts)),
   гэхдээ preview deployment болон өөр порт дээр ажиллахын тулд `/**` хэвээр
   хэрэгтэй.
3. **Authentication → Providers → Google** (сонголт):
   - Google Cloud Console → **APIs & Services → Credentials → OAuth client ID**
     (Web application) үүсгэ.
   - **Authorized redirect URI** нь Supabase-ынх: `https://<ref>.supabase.co/auth/v1/callback`
     (манай сайтын хаяг БИШ).
   - Client ID + Secret-ийг Supabase-ийн Google provider дээр тавиад **Enable**.
4. **Authentication → Policies → Password**: хамгийн багадаа 8 тэмдэгт.

---

## STEP 3 — Supabase CLI + Docker (локал хөгжүүлэлт)

### 3.1 Supabase CLI

```bash
brew install supabase/tap/supabase
supabase --version
```

### 3.2 Docker Desktop

Локал Supabase нь Docker container дээр ажилладаг. **Та `docker` командыг өөрөө бичихгүй** —
Supabase CLI Docker-ийг таны өмнөөс жолооддог. Зөвхөн Docker Desktop **асаалттай** байх ёстой.

1. https://www.docker.com/products/docker-desktop/ → **Download for Mac** (Apple Silicon эсвэл Intel).
2. `.dmg`-г нээж Applications руу чир.
3. Docker Desktop-ыг нээ, зөвшөөрөл асуувал зөвшөөр.
4. Menu bar-т халимны icon гарч "Docker Desktop is running" болтол хүлээ.

**macOS-д PATH асуудал:** Docker Desktop нь `docker` командыг `~/.docker/bin/` дор тавьдаг ба
энэ нь shell-ийн PATH-д автоматаар ордоггүй. `~/.zshrc` файлд дараах мөрийг нэм:

```bash
export PATH="$HOME/.docker/bin:$PATH"
```

Дараа нь шинэ terminal нээгээд `docker info` ажиллаж байгааг шалга.

### 3.3 Локал stack асаах

```bash
cd ~/Desktop/gerhub/solio
supabase start          # эхний удаа хэдэн GB image татна, 5-15 минут
```

Дуусахад локал endpoint болон key-үүдийг хэвлэнэ:

```
API URL:     http://127.0.0.1:54321
DB URL:      postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL:  http://127.0.0.1:54323
Mailpit URL: http://127.0.0.1:54324        ← локал email хайрцаг
Publishable key: sb_publishable_…
Secret key:      sb_secret_…
```

> **Эдгээр локал key нь нууц БИШ.** Supabase-ийн бүх суулгацад ижил, олон нийтэд мэдэгдсэн демо
> утга бөгөөд зөвхөн `localhost` дээр ажиллана. Development-д ашиглана.

### 3.4 Cloud project-той холбох

```bash
supabase login                                  # browser нээгдэнэ
supabase link --project-ref <STEP 2.3-ийн ref>  # DB нууц үг асууна
```

### 3.5 Байнга хэрэглэх командууд

| Команд | Тайлбар |
|---|---|
| `supabase start` / `stop` / `status` | Локал stack асаах / унтраах / төлөв |
| `supabase migration new <нэр>` | Шинэ хоосон migration файл |
| `supabase db reset` | Локал DB устгаад бүх migration + seed дахин ажиллуулах |
| `supabase db push` | Migration-уудыг **cloud** руу буулгах |
| `supabase test db` | pgTAP тест |
| `supabase gen types typescript --local > src/types/database.ts` | TS төрөл үүсгэх |

---

## STEP 4 — Cloudflare (DNS, аюулгүй байдал, Turnstile)

> Домэйн худалдаж аваагүй бол энэ алхмыг **алгасаж болно**. Хөгжүүлэлт `localhost` дээр
> үргэлжилнэ. Домэйн нь зөвхөн production deploy-д шаардлагатай.

### 4.1 Бүртгэл ба домэйн

1. https://dash.cloudflare.com/sign-up → бүртгүүлж email баталгаажуул.
2. **Add a site** → домэйнээ оруул (жишээ: `solio.mn`) → **Free** plan сонго.
3. Cloudflare хоёр nameserver өгнө. Домэйн бүртгүүлсэн газраа (жишээ: `.mn` домэйн бол
   **Datacom**) орж nameserver-ээ эдгээрээр солино. Дэлгэрэх нь 1–24 цаг.

### 4.2 SSL/TLS

**SSL/TLS → Overview → Full (strict)** сонго.
`Flexible` бол **бүү сонго** — Cloudflare-аас Vercel хүртэлх холболт шифрлэгдэхгүй болно.

### 4.3 Аюулгүй байдал

- **Security → WAF → Managed rules** — Cloudflare Free Managed Ruleset асаа.
- **Security → Bots** — Bot Fight Mode асаа.
- **Security → WAF → Rate limiting rules** — доорх зам дээр хязгаар тавь:

| Зам | Хязгаар |
|---|---|
| `/login`, `/register` | 1 минутад 10 хүсэлт / IP |
| `/reset-password` | 1 цагт 5 хүсэлт / IP |
| `/api/uploads/*` | 1 цагт 30 хүсэлт / IP |

### 4.4 Turnstile (CAPTCHA)

1. Зүүн цэсээс **Turnstile** → **Add site**.
2. **Domain:** `solio.mn` (локал тестэд `localhost` мөн нэм).
3. **Widget mode:** Managed.
4. Хоёр key гарна:

| Key | Нууц уу | `.env.local` |
|---|---|---|
| **Site Key** | Нууц биш | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| **Secret Key** | 🔴 Нууц | `TURNSTILE_SECRET_KEY` |

---

## STEP 5 — Cloudflare R2 (номын зураг)

> ⚠️ **Энэ алхам картын мэдээлэл шаардана** (сард 10GB үнэгүй ч баталгаажуулалтад хэрэгтэй).
> Хийхийг хүсэхгүй бол алгас — апп `LocalDevelopmentStorage`-оор ажиллана.

### 5.1 Bucket үүсгэх

1. Cloudflare dashboard → зүүн цэс → **R2**.
2. Анх удаа бол картаа нэмнэ.
3. **Create bucket** → **Name:** `solio-book-images` → **Location:** Automatic → **Create**.

### 5.2 Account ID

**R2 → Overview** хуудасны баруун талд **Account ID** байна. Хуулж аваад `.env.local`-д
`R2_ACCOUNT_ID` гэж хадгал.

### 5.3 API token

1. **R2 → Manage R2 API Tokens** → **Create API Token**.
2. **Token name:** `solio-app`
3. **Permissions:** **Object Read & Write** (Admin **БҮҮ** сонго — хэт өргөн эрх).
4. **Specify bucket:** `solio-book-images` — зөвхөн энэ bucket-д хязгаарла.
5. **TTL:** хүсвэл хугацаа тавь.
6. **Create API Token** → гурван утга гарна:

| Гарах утга | `.env.local` |
|---|---|
| **Access Key ID** | `R2_ACCESS_KEY_ID` |
| **Secret Access Key** | `R2_SECRET_ACCESS_KEY` 🔴 **нэг л удаа харагдана** |
| (bucket нэр) | `R2_BUCKET_NAME=solio-book-images` |

### 5.4 Нийтийн хандалт

R2 bucket нь **анхдагчаар хаалттай** — S3 API-аар бичиж уншиж болох ч браузер зургийг татаж
чадахгүй. Нийтийн хандалт нээх хоёр арга байна.

**Арга A — домэйнгүйгээр (одоо шууд ажиллана)**

1. Bucket → **Settings** → **Public Development URL** → **Enable**.
2. `https://pub-xxxxxxxx.r2.dev` хэлбэрийн хаяг өгнө. Түүнийг хуулж ав.
3. `.env.local`-д: `NEXT_PUBLIC_R2_PUBLIC_URL=https://pub-xxxxxxxx.r2.dev`

⚠️ Cloudflare энэ хаягийг **rate limit** хийдэг ба production-д зориулаагүй гэж тодорхой
хэлдэг. Хөгжүүлэлт болон туршилтад тохиромжтой.

**Арга B — custom domain (production-ы зөв арга)**

Домэйн тань Cloudflare дээр байх шаардлагатай (STEP 4).

1. Bucket → **Settings** → **Custom Domains** → **Connect Domain**.
2. `images.solio.mn` оруул → Cloudflare DNS бичлэгийг автоматаар үүсгэнэ.
3. `.env.local`-д: `NEXT_PUBLIC_R2_PUBLIC_URL=https://images.solio.mn`

> ⚠️ Энэ баримт дахь `images.solio.mn` бол **жишээ**. Өөрийн домэйноо бичнэ үү — байхгүй
> домэйн бичвэл зураг R2 руу амжилттай орсон ч браузерт бүгд эвдэрч харагдана.

> **Дутуу тохиргоо:** таван хувьсагчийн аль нэг нь хоосон бол апп `LocalDevelopmentStorage`
> руу шилжинэ. Development-д консол дээр аль хувьсагч дутууг нэрлэж анхааруулна;
> production-д сервер огт эхлэхгүй.

### 5.5 CORS

Browser нь R2 руу **шууд** PUT хийдэг (зураг Vercel-ээр дамжихгүй), тиймээс CORS хэрэгтэй.

Bucket → **Settings** → **CORS Policy** → **Add CORS policy**:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://solio.mn"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "content-length"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## STEP 6 — Vercel

1. https://vercel.com → **Sign in with GitHub**.
2. **Add New → Project** → `solio` repo-г **Import**.
3. **Framework Preset:** Next.js (автоматаар танина). Build command өөрчлөх шаардлагагүй.
4. **Environment Variables** — доорх хүснэгтийн дагуу орчин тус бүрээр оруул:

| Хувьсагч | Development | Preview | Production |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | локал (`127.0.0.1:54321`) | cloud | cloud |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | локал | cloud | cloud |
| `SUPABASE_SERVICE_ROLE_KEY` 🔴 | локал | cloud | cloud |
| `R2_ACCOUNT_ID` 🔴 | (хоосон) | ✅ | ✅ |
| `R2_ACCESS_KEY_ID` 🔴 | (хоосон) | ✅ | ✅ |
| `R2_SECRET_ACCESS_KEY` 🔴 | (хоосон) | ✅ | ✅ |
| `R2_BUCKET_NAME` | (хоосон) | ✅ | ✅ |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | (хоосон) | ✅ | ✅ |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | (хоосон) | ✅ | ✅ |
| `TURNSTILE_SECRET_KEY` 🔴 | (хоосон) | ✅ | ✅ |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Vercel preview URL | `https://solio.mn` |

> ⚠️ **Preview орчинд production Supabase-ийг ашиглах нь эрсдэлтэй** — PR дээрх алдаатай код
> жинхэнэ өгөгдлийг өөрчилж болно. Боломжтой бол Supabase дээр `solio-staging` гэсэн хоёр дахь
> project үүсгээд Preview-д түүнийг зааж өг.

5. **Deploy** дар.
6. Домэйн холбох: **Project → Settings → Domains** → `solio.mn` нэм. Vercel DNS бичлэг өгнө;
   түүнийг Cloudflare DNS дээр нэм (proxy status **Proxied** буюу улбар шар үүл).
7. Deploy хийсний дараа **Supabase → Authentication → URL Configuration** руу буцаж:
   - Site URL → `https://solio.mn`
   - Redirect URLs → `https://solio.mn/**`, `https://www.solio.mn/**` нэмэгдсэн эсэхийг
     шалга (§2.4 — `/**`-гүй яг таарах бичлэг нэвтрэлтийг эвддэг).
8. **NEXT_PUBLIC_SITE_URL** environment variable нь Site URL-тэй яг ижил байх ёстой
   (`https://solio.mn`). Vercel дээр **Production** орчинд тавина. Хоосон
   утгатай үлдээвэл апп deployment-ийн өөрийнх нь домэйн руу шилжинэ —
   ажиллана, гэхдээ canonical URL болон шошгон дээрх QR нь `vercel.app` хаяг
   заана.

---

## STEP 7 — Локал ажиллуулах

```bash
git clone https://github.com/<чиний-нэр>/solio.git
cd solio
npm install

cp .env.example .env.local
# .env.local-ыг нээж, дээрх алхмуудаас авсан утгуудаа өөрөө оруул

supabase start                                  # Docker асаалттай байх ёстой
supabase db reset                               # migration + seed ажиллуулна
supabase gen types typescript --local > src/types/database.ts

npm run dev                                     # http://localhost:3000
```

Хөгжүүлэлтийн үед илгээгдсэн бүх email (баталгаажуулалт, нууц үг сэргээх) нь жинхэнэ email рүү
явахгүй — **Mailpit** дээр очно: http://localhost:54324

---

## STEP 8 — Алдааны хяналт (сонголт, Sentry)

**Зөвлөмж: MVP-д ашиглах нь зүйтэй.** Free tier сард 5,000 алдаа барина.

1. https://sentry.io → **Sign up** → **Create Project** → Platform: **Next.js** → Name: `solio`.
2. **Settings → Projects → solio → Client Keys (DSN)** → DSN хуулж ав.
3. `.env.local`:
   - `SENTRY_DSN` — серверийн талд
   - `NEXT_PUBLIC_SENTRY_DSN` — browser-ийн талд (тусдаа, хязгаарлагдсан key үүсгэвэл дээр)
4. Vercel дээр мөн адил хувьсагчдыг Production/Preview-д нэм.

> **Хувийн мэдээлэл хамгаалалт:** `beforeSend` hook нь `email`, `phone`, болон `sb-*` cookie-г
> Sentry рүү илгээхийн өмнө устгана (brief §40). DSN хоосон бол алдаа зүгээр л серверийн лог руу
> бүтэцлэгдсэн JSON байдлаар бичигдэнэ — хүсэлт эвдрэхгүй.

---

## Орчны хувьсагчийн бүрэн хүснэгт

| Хувьсагч | Зориулалт | Public/Secret | Хаанаас авах | D | P | Pr |
|---|---|:--:|---|:--:|:--:|:--:|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase REST/Auth endpoint | 🟢 Public | STEP 2.2 | ✅ | ✅ | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Клиентийн Supabase key | 🟢 Public | STEP 2.2 | ✅ | ✅ | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | RLS тойрдог админ key | 🔴 **Secret** | STEP 2.2 | ✅ | ✅ | ✅ |
| `SUPABASE_PROJECT_REF` | `supabase link`-д | 🟡 Хагас | STEP 2.3 | ✅ | – | – |
| `R2_ACCOUNT_ID` | R2 account | 🔴 Secret | STEP 5.2 | – | ✅ | ✅ |
| `R2_ACCESS_KEY_ID` | R2 token | 🔴 Secret | STEP 5.3 | – | ✅ | ✅ |
| `R2_SECRET_ACCESS_KEY` | R2 token нууц | 🔴 **Secret** | STEP 5.3 | – | ✅ | ✅ |
| `R2_BUCKET_NAME` | Bucket нэр | 🔴 Secret | STEP 5.1 | – | ✅ | ✅ |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Зургийн CDN домэйн | 🟢 Public | STEP 5.4 | – | ✅ | ✅ |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile widget | 🟢 Public | STEP 4.4 | – | ✅ | ✅ |
| `TURNSTILE_SECRET_KEY` | Turnstile баталгаажуулалт | 🔴 Secret | STEP 4.4 | – | ✅ | ✅ |
| `NEXT_PUBLIC_SITE_URL` | Каноник хаяг | 🟢 Public | өөрөө | ✅ | ✅ | ✅ |
| `SENTRY_DSN` | Серверийн алдаа | 🔴 Secret | STEP 8 | – | ✅ | ✅ |
| `NEXT_PUBLIC_SENTRY_DSN` | Browser алдаа | 🟢 Public | STEP 8 | – | ✅ | ✅ |

**D** = development · **P** = preview · **Pr** = production

> 🔴 тэмдэгтэй хувьсагчид `NEXT_PUBLIC_` угтвар **хэзээ ч** авахгүй. Next.js нь `NEXT_PUBLIC_`
> угтвартай бүх хувьсагчийг browser bundle рүү шууд оруулдаг.

---

## Өгөгдөл устгах (зөвхөн эзэмшигч)

Хэрэглэгч юу ч устгаж чадахгүй — `authenticated` ч, `service_role` ч. Гэхдээ
өгөгдлийн сангийн шууд холболт (Supabase Studio → SQL Editor, эсвэл `psql`)
устгах эрхтэй. Шалтгааныг [database.md §6.1](./database.md)-ээс уншина уу.

**Мөр устгах.** Studio → Table Editor дээр trash товч шууд ажиллана
(`book_copies`, `swaps`, `book_images`, `reports`, `notifications`,
`ownership_events`, `audit_logs`). Хамааралтай мөрүүд нь өөрөө дагаж устана.

**Хэрэглэгч бүрэн устгах.** Auth → Users дээрх "Delete user" нь ажиллахгүй —
номын түүх нь профайлыг тогтоож барьдаг. Оронд нь SQL Editor дээр:

```sql
select private.purge_user('<user-uuid>');
-- purged someone@example.com — 3 copies, 1 catalogue entries
```

Энэ нь тухайн хүний зураг, үнэлгээ, гомдол, swap, өмчлөлийн түүх, номын хувь,
audit мөрийг дарааллаар нь устгаад эцэст нь `auth.users`-ээс хасна. Бусдын
гарт байгаа ном эсвэл өөр хүн үнэлгээ өгсөн каталогийн бичлэг хэвээр үлдэнэ.

**Ном бүрэн устгах.**

```sql
select private.purge_book('<book-uuid>');
```

> R2 дахь зургийн файлыг эдгээр функц устгахгүй — зөвхөн өгөгдлийн сангийн
> мөрийг устгана. Bucket-аас өнчин объект цэвэрлэх нь тусдаа ажил.

---

## Түгээмэл алдаа ба шийдэл

| Шинж тэмдэг | Шалтгаан | Шийдэл |
|---|---|---|
| Апп эхлэхэд `Missing environment variable: X` | `.env.local` дутуу | `.env.example`-ийг харьцуулж дутуу хувьсагчийг нөх |
| Бүх query хоосон буцаана, алдаа гарахгүй | RLS policy бүх мөрийг хаасан | Studio → SQL Editor дээр `set role authenticated;` тавиад query-г гараар туршиж policy-г шалга |
| `docker: command not found` | Docker Desktop суусан ч PATH-д байхгүй | `~/.zshrc`-д `export PATH="$HOME/.docker/bin:$PATH"` нэм |
| `supabase start` алдаа өгнө | Docker Desktop асаагүй | Docker Desktop-ыг нээ, халимны icon гарахыг хүлээ |
| Email баталгаажуулалт "requested path is invalid" | Redirect URL бүртгэгдээгүй | Supabase → Auth → URL Configuration дээр callback URL-ээ нэм |
| Зураг upload дээр CORS алдаа | R2 CORS дүрэм дутуу/буруу origin | STEP 5.5-ыг шалга; `AllowedOrigins`-д яг тухайн origin байх ёстой |
| Зураг ачаалагдахгүй, 400 алдаа | `next.config.ts` дээр host бүртгэгдээгүй | `images.remotePatterns`-д `images.solio.mn` нэм |
| Refresh хийхэд session алга болно | proxy.ts cookie-г буцааж бичихгүй байна | `src/proxy.ts` нь Supabase-ийн бичсэн cookie-г **response дээр** дамжуулж байгаа эсэхийг шалга |
| `permission denied for table X` | RLS policy байгаа ч GRANT байхгүй | Migration дээр `grant select, insert … to authenticated` нэмэгдсэн эсэхийг шалга |
| Migration cloud дээр амжилтгүй | Локал болон cloud schema зөрсөн | `supabase db reset` локал дээр цэвэр ажиллаж байгааг эхлээд батал |
