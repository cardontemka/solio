# Solio — Swap workflow ба atomic transaction

> Солилцооны бүх төлөв, шилжилт, тэдгээрийг хаана албадаж байгаа, өмчлөл хэрхэн atomic байдлаар
> шилждэг тухай. Холбоотой: [database.md](./database.md) · [security.md](./security.md) ·
> [architecture.md](./architecture.md)

> **Энэ баримт дахь SQL нь PostgreSQL 17 (локал Supabase) дээр бодитоор ажиллуулж, доорх бүх
> хамгаалалтын тест давсан.** §8-д хэмжсэн үр дүн байна.

---

## 1. Солилцооны бүрэн урсгал

```
   Алтан "The Hobbit"-ийг эзэмшинэ          Болд "Монголын нууц товчоо"-г эзэмшинэ
              │                                          │
              │  Алтан Болдын номыг хүсэв.                │
              │  Хариуд нь өөрийн Hobbit-оо санал болгов. │
              ▼                                          │
      ┌─────────────────┐                                │
      │   REQUESTED     │  swap_items:                   │
      │                 │    Hobbit        → offered     │
      │                 │    Нууц товчоо   → requested   │
      └────────┬────────┘                                │
               │  Болд хүлээн авав ◄─────────────────────┘
               ▼
      ┌─────────────────┐   хоёр хуулбар → status='reserved'
      │    ACCEPTED     │   (өөр хүн эдгээрийг хүсэх боломжгүй болно)
      └────────┬────────┘
               │  Хоёр тал БИЕЧЛЭН уулзаж номоо солино
               │
               │  Алтан "гардуулсан" гэж дарав
               ▼
      ┌─────────────────┐   confirmed_by = Алтан
      │   CONFIRMED     │   ⚠ Алтан ДАХИН дарж дуусгаж ЧАДАХГҮЙ
      └────────┬────────┘
               │  Болд "хүлээн авсан" гэж дарав
               │  (өөр хүн, тиймээс дуусгах эрх нээгдэнэ)
               ▼
      ┌─────────────────┐   НЭГ ATOMIC TRANSACTION дотор:
      │   COMPLETED     │     · owner_id солигдоно (2 хуулбар)
      │                 │     · ownership_events 2 мөр бичигдэнэ
      │                 │     · status → 'swapped', transfer_count+1
      │                 │     · swap → COMPLETED, completed_at
      │                 │     · audit_logs 1 мөр
      │                 │     · notifications 2 мөр
      └─────────────────┘   Аль нэг нь бүтэлгүйтвэл БҮГД буцна.

   Үр дүн:  Hobbit → Болд        Нууц товчоо → Алтан
```

**Гол шийдвэр:** "хоёр тал зөвшөөрсний дараа өмчлөл шилжинэ" гэдгийг `CONFIRMED` төлөв илэрхийлнэ.
`CONFIRMED` = "нэг тал баталгаажуулсан". `COMPLETED` = "**өөр** тал баталгаажуулсан".
`v_swap.confirmed_by = v_actor` шалгалт нь нэг хүн дангаараа солилцоо дуусгахыг **бүтцээрээ**
боломжгүй болгоно — `if` биш, DB-ийн инвариант.

---

## 2. `swaps.status` — state machine

```
                    ┌──────────────┐
                    │  REQUESTED   │◄── эхлэл (request_swap RPC)
                    └──┬────┬────┬─┘
        Болд хүлээн авав│    │    │Алтан цуцлав
                        │    │    └──────────────┐
                        │    │Болд татгалзав     │
                        ▼    ▼                   ▼
              ┌──────────┐  ┌──────────┐  ┌───────────┐
              │ ACCEPTED │  │ REJECTED │  │ CANCELLED │
              └──┬───┬───┘  └──────────┘  └───────────┘
   аль нэг тал   │   │  аль нэг тал цуцлав  ▲   ▲ ТӨГСГӨЛИЙН
   баталгаажуулав│   └──────────────────────┘   │ ТӨЛӨВҮҮД
                 ▼                              │ (гарах ирмэг БАЙХГҮЙ)
          ┌─────────────┐                       │
          │  CONFIRMED  │                       │
          └──────┬──────┘                       │
                 │ НӨГӨӨ тал баталгаажуулав     │
                 ▼                              │
          ┌─────────────┐                       │
          │  COMPLETED  │───────────────────────┘
          └─────────────┘
```

### 2.1 Шилжилтийн бүрэн хүснэгт

| # | Хаанаас | Хаашаа | Хэн эхлүүлж болох | Нөхцөл (түгжээний ДАРАА дахин шалгагдана) | Хажуугийн үр дагавар (нэг transaction) | Хаана албадана |
|---|---|---|---|---|---|---|
| 1 | — | `REQUESTED` | requester | санал болгож буй хуулбар нь actor-ынх, `available`, `active`; хүссэн хуулбар нь өөр хүнийх, `available`, `active`; тухайн хуулбар дээр actor-ын нээлттэй swap байхгүй; 24 цагт ≤20 хүсэлт | 2 `swap_items` мөр; audit `swap.requested`; мэдэгдэл → responder | `RPC:request_swap` |
| 2 | `REQUESTED` | `ACCEPTED` | **зөвхөн responder** | хоёр хуулбар `available` ба эзэд нь хэвээр | хоёр хуулбар → `reserved`; audit; мэдэгдэл → requester | `RPC:respond_to_swap('accept')` + `TRG:swaps_guard` |
| 3 | `REQUESTED` | `REJECTED` | **зөвхөн responder** | — | `closed_at`; audit; мэдэгдэл → requester | `RPC:respond_to_swap('reject')` + `TRG` |
| 4 | `REQUESTED` | `CANCELLED` | **зөвхөн requester** | — | `closed_at`; audit; мэдэгдэл → responder | `RPC:respond_to_swap('cancel')` + `TRG` |
| 5 | `ACCEPTED` | `CANCELLED` | **аль ч тал** | — | `reserved` хуулбарууд → `available`; `closed_at`; audit; мэдэгдэл нөгөө талд | `RPC:respond_to_swap('cancel')` + `TRG` |
| 6 | `ACCEPTED` | `CONFIRMED` | **аль ч тал** (эхэлж дарсан нь) | actor нь оролцогч | `confirmed_by = actor`; audit; мэдэгдэл нөгөө талд | `RPC:complete_swap` PHASE 1 |
| 7 | `CONFIRMED` | `COMPLETED` | **`confirmed_by` БИШ тал** | `actor <> confirmed_by`; хуулбар бүр `reserved` ба эзэмшил хэвээр | §4-ийн бүх бичилт | `RPC:complete_swap` PHASE 2 |

### 2.2 ЗӨВШӨӨРӨГДӨХГҮЙ шилжилтүүд

6 төлөв → 30 боломжит эрэмбэлэгдсэн хос. Үүнээс **6 нь зөвшөөрөгдөнө** (дээрх #2–#7),
үлдсэн **24 нь татгалзана**. Тодруулбал:

```
REQUESTED → CONFIRMED, COMPLETED
ACCEPTED  → REQUESTED, REJECTED, COMPLETED
CONFIRMED → REQUESTED, ACCEPTED, REJECTED, CANCELLED
COMPLETED → бүх зүйл           ┐
REJECTED  → бүх зүйл           ├── ТӨГСГӨЛИЙН — гарах ирмэг огт байхгүй
CANCELLED → бүх зүйл           ┘
```

Бүгд `INVALID_TRANSITION_<from>_TO_<to>` алдааг `23514` SQLSTATE-тэй өгнө → HTTP 400.

**Хоёр зориудын шийдвэр:**

- **`CONFIRMED → CANCELLED` зөвшөөрөгдөхгүй.** Нэг тал "гардуулсан" гэж баталсны дараа нөгөө тал
  дангаараа цуцлах боломжтой байвал: ном аваад дараа нь цуцлах луйвар бий болно. Маргаан гарвал
  `reports` → админ `admin_correct_ownership()` замаар шийднэ.
- **`ACCEPTED → REJECTED` зөвшөөрөгдөхгүй** (brief зөвхөн `REQUESTED → REJECTED`-ийг заасан).
  Хүлээн авсны дараа буцах нь `CANCELLED` — хоёр талд нээлттэй, буруутгалгүй ирмэг.

### 2.3 Албадлагын 5 давхарга (гаднаас дотогш)

| # | Давхарга | Юу хийдэг | Найдвартай эсэх |
|---|---|---|---|
| 1 | UI (`state-machine.ts`) | товч идэвхгүй болгоно | ❌ зөвхөн гоо сайхан |
| 2 | Server Action | дахин authenticate, Zod validation, rate limit | ⚠ халдагч тойрч болно |
| 3 | `SECURITY DEFINER` RPC | түгжээ, дахин унших, actor шалгах, ирмэг шалгах | ✅ |
| 4 | `TRG:swaps_guard` | DELETE хориглох, төгсгөлийн мөр хамгаалах, ирмэгийн цагаан жагсаалт | ✅ **`service_role` key-г ч зогсооно** |
| 5 | RLS + GRANT | `authenticated`-д `swaps` дээр INSERT/UPDATE/DELETE **огт байхгүй** | ✅ PostgREST-ээр шууд бичих зам байхгүй |

> **№4 яагаад чухал вэ:** trigger нь `BYPASSRLS` эрхтэй role дээр ч ажиллана. Тиймээс
> `service_role` key задарсан ч дууссан гүйлгээг дахин бичих боломжгүй.

```sql
create or replace function private.is_valid_swap_edge(p_from text, p_to text)
returns boolean language sql immutable set search_path = ''
as $$
  select (p_from, p_to) in (
    ('REQUESTED','ACCEPTED'), ('REQUESTED','REJECTED'), ('REQUESTED','CANCELLED'),
    ('ACCEPTED','CONFIRMED'), ('ACCEPTED','CANCELLED'), ('CONFIRMED','COMPLETED'));
$$;

-- ЗӨРИУДААР security definer БИШ: current_user нь жинхэнэ дуудагчийг харуулах ёстой.
create or replace function private.is_privileged_context()
returns boolean language sql stable
as $$ select current_user = 'postgres' $$;

create or replace function private.swaps_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'SWAPS_ARE_NEVER_DELETED' using errcode = '42501';
  end if;
  if not private.is_privileged_context() then
    raise exception 'DIRECT_SWAP_WRITE_FORBIDDEN' using errcode = '42501',
      hint = 'Swap-ууд зөвхөн request_swap/respond_to_swap/complete_swap-аар өөрчлөгдөнө.';
  end if;
  if old.status in ('COMPLETED','REJECTED','CANCELLED') then
    raise exception 'SWAP_IS_TERMINAL_%', old.status using errcode = '42501';
  end if;
  if new.requester_id is distinct from old.requester_id
     or new.responder_id is distinct from old.responder_id
     or new.created_at  is distinct from old.created_at then
    raise exception 'SWAP_IMMUTABLE_FIELD' using errcode = '23514';
  end if;
  if new.status is distinct from old.status
     and not private.is_valid_swap_edge(old.status, new.status) then
    raise exception 'INVALID_TRANSITION_%_TO_%', old.status, new.status using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger swaps_guard_trg before update or delete on public.swaps
  for each row execute function private.swaps_guard();
```

---

## 3. `book_copies.status` — state machine

MVP-д төгсгөлийн төлөв **байхгүй** (`lost` нь ирээдүйд эхний нь болно).

```
        ┌───────────────┐   эзэн нуув     ┌────────────┐
   ────►│   available   │◄───────────────►│  inactive  │
   шинэ └───┬───────────┘                 └────────────┘
   бүртгэл  │      ▲                             ▲
            │      │                             │
   swap     │      │ swap цуцлагдав              │ эзэн нуув
   хүлээн   │      │ (систем)                    │
   авагдав  ▼      │                             │
        ┌───────────────┐                        │
        │   reserved    │                        │
        └───────┬───────┘                        │
                │ swap дууслаа (систем)          │
                ▼                                │
        ┌───────────────┐  ШИНЭ эзэн дахин       │
        │   swapped     │──зарлав────────────────┘
        └───────────────┘        │
                                 └──► available
```

| # | Хаанаас | Хаашаа | Хэн | Нөхцөл | Албадлага |
|---|---|---|---|---|---|
| 1 | — | `available` | эзэн (INSERT) | `owner_id = auth.uid()`; `custodian_id = owner_id`; 24 цагт ≤30 хуулбар | `RLS` + `TRG:initial_ownership` |
| 2 | `available` | `inactive` | **эзэн** | нээлттэй swap-д ороогүй | `TRG:book_copies_guard` |
| 3 | `inactive` | `available` | **эзэн** | `moderation_status='active'` | `TRG` |
| 4 | `available` | `reserved` | **зөвхөн систем** | swap `REQUESTED`, actor нь responder | `RPC:respond_to_swap('accept')` |
| 5 | `reserved` | `available` | **зөвхөн систем** | swap `ACCEPTED`-ээс `CANCELLED` рүү | `RPC:respond_to_swap('cancel')` |
| 6 | `reserved` | `swapped` | **зөвхөн систем** | `complete_swap` PHASE 2, `owner_id` солигдохтой хамт | `RPC:complete_swap` |
| 7 | `swapped` | `available` | **шинэ эзэн** | дахин зарлахаар шийдвэл | `TRG` |
| 8 | `swapped` | `inactive` | **шинэ эзэн** | — | `TRG` |

**Татгалзах:** `available→swapped`, `inactive→reserved`, `inactive→swapped`,
`reserved→inactive` (эхлээд swap-аа цуцлана), `swapped→reserved` (эхлээд дахин зарлана),
эзний санаачилсан `reserved` руу/аас гарах бүх хөдөлгөөн, мөн privileged context-ээс гадуур
`owner_id`/`custodian_id`/`book_id`-д хийх **аливаа** өөрчлөлт.

> **Яагаад дууссан хуулбар `available` биш `swapped` болдог вэ?**
> Дөнгөж хүлээн авсан номыг автоматаар зарах нь **зөвшөөрлийн алдаа** — шинэ эзэн үүнийг дахин
> солилцоно гэж хэлээгүй. `swapped` = "минийх, саяхан авсан, зараагүй". Эзэн өөрөө дахин зарлана.
> Ингэснээр brief-ийн шаардсан 4 статус бүр бодит утгатай болно.

### 3.1 Ирээдүйн custody төлөвүүд

```sql
-- Phase 2 (cafe/custody) migration — НЭМЭЛТ, эвдэх өөрчлөлт БИШ
alter domain public.copy_status drop constraint copy_status_values;
alter domain public.copy_status add constraint copy_status_values
  check (value in ('available','reserved','swapped','inactive',
                   'in_transit','at_partner_location',
                   'custody_requested','custody_confirmed','lost'));
```

`book_copies_guard`-д шинэ ирмэг нэмнэ. **Одоо байгаа мөр, багана, түүх хөндөгдөхгүй.**

---

## 4. Atomic swap completion

### 4.1 Түгжээний дараалал — төслийн хэмжээний дүрэм

Swap эсвэл өмчлөлийн төлөвт хүрдэг **аливаа** ирээдүйн функц үүнийг үг үсгээр нь дагана:

```
0. pg_advisory_xact_lock(hash('solio.swap:' || swap_id))   ← swap тус бүрээр цуваачлана
1. swaps          — нэг мөр, PK-аар,             FOR UPDATE
2. book_copies    — N мөр, ORDER BY id ASC,      FOR UPDATE
3. INSERT ownership_events / audit_logs / notifications   (зөрчилдөх түгжээгүй)
```

**Яагаад ийм дараалал вэ:**

- **1 → 2 дараалал** нь нэг хуулбарыг хуваалцсан хоёр swap-ийн сонгодог deadlock-оос сэргийлнэ.
- **2 дахь түвшний `id`-гийн өсөх эрэмбэ** нь нэг хуулбарыг хуваалцсан **өөр** хоёр swap-ийг барина.
  PostgreSQL-ийн `LockRows` node нь `Sort`-ийн дээр байрладаг тул `ORDER BY id … FOR UPDATE` нь
  үнэхээр id-гийн дарааллаар түгжээ авдаг.
- **Advisory lock** нь бүр өмнө нь swap тус бүрийг цуваачилна — хоёр хүн зэрэг дарахад ч нэг нь
  хүлээнэ.

**Isolation түвшин:** `READ COMMITTED` (Supabase-ийн анхдагч) хэвээр. Утга бүрийг **түгжээний
дараа** дахин уншина, эцсийн төлөв солих нь хамгаалалттай compare-and-set — ингэснээр READ
COMMITTED-ийн "мөр харагдахгүй" зан төлөв нь чимээгүй юу ч хийхгүй өнгөрөхийн оронд чанга
`40001` алдаа болно.

**Retry бодлого:** дуудагч `40P01` (deadlock) болон `40001` (serialization) дээр **нэг удаа**
дахин оролдоно. Бусад ямар ч алдаан дээр дахин оролдохгүй.

### 4.2 Функцийн бүтэн эх код

```sql
-- ============================================================================
-- public.complete_swap — book_copies.owner_id-г өөрчилдөг системийн ЦОРЫН
-- ГАНЦ код зам. Brief §47: PATCH /book/:id/owner гэж байхгүй.
--
-- PHASE 1 (ACCEPTED  → CONFIRMED): эхний оролцогч гардуулсныг баталгаажуулна.
-- PHASE 2 (CONFIRMED → COMPLETED): НӨГӨӨ оролцогч баталгаажуулна; өмчлөл шилжинэ.
-- ============================================================================
create or replace function public.complete_swap(p_swap_id uuid)
returns public.swaps
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_other  uuid;
  v_swap   public.swaps%rowtype;
  v_items  int;
  v_locked int;
  v_moved  int;
begin
  ------------------------------------------------------------------ 0. AUTHN
  -- SECURITY DEFINER нь RLS-ийг тойрдог ⇒ энэ функц өөрийн authorization-оо
  -- бүрэн хариуцна.
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles
                  where id = v_actor and account_status = 'active') then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  ------------------------------------------------------------- 0b. ЦУВААЧЛАЛ
  perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('solio.swap:' || p_swap_id::text, 0));

  ---------------------------------------------------------- ТҮГЖЭЭ 1: үндэс
  select * into v_swap from public.swaps where id = p_swap_id for update;
  if not found then
    raise exception 'SWAP_NOT_FOUND' using errcode = 'P0002';
  end if;

  -------------------------------------------- authorize — ТҮГЖЭЭНИЙ ДАРАА
  if v_actor not in (v_swap.requester_id, v_swap.responder_id) then
    raise exception 'NOT_A_PARTICIPANT' using errcode = '42501';
  end if;
  v_other := case when v_actor = v_swap.requester_id
                  then v_swap.responder_id else v_swap.requester_id end;

  ------------------------------------------------------------------ PHASE 1
  if v_swap.status = 'ACCEPTED' then
    update public.swaps
       set status = 'CONFIRMED', confirmed_by = v_actor
     where id = p_swap_id and status = 'ACCEPTED'
    returning * into v_swap;
    if not found then
      raise exception 'SWAP_STATE_CHANGED_CONCURRENTLY' using errcode = '40001';
    end if;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (v_actor, 'swap.confirmed', 'swap', p_swap_id::text,
            jsonb_build_object('from','ACCEPTED','to','CONFIRMED'));
    insert into public.notifications (user_id, type, entity_type, entity_id)
    values (v_other, 'swap_confirmed', 'swap', p_swap_id);
    return v_swap;
  end if;

  ------------------------------------------------------------------ PHASE 2
  if v_swap.status <> 'CONFIRMED' then
    raise exception 'INVALID_TRANSITION_%_TO_COMPLETED', v_swap.status
      using errcode = '23514';
  end if;
  -- ★ "А хүн Б-ийн swap-ийг дангаараа дуусгаж чадах уу?" гэсэн асуултын
  --   БҮТЦИЙН хариулт: үгүй.
  if v_swap.confirmed_by = v_actor then
    raise exception 'AWAITING_COUNTERPARTY_CONFIRMATION' using errcode = '23514';
  end if;

  -------------------------- ТҮГЖЭЭ 2: хуулбар бүр, PK-гийн ӨСӨХ эрэмбээр
  select count(*) into v_locked from (
    select bc.id from public.book_copies bc
     where bc.id in (select si.book_copy_id from public.swap_items si
                      where si.swap_id = p_swap_id)
     order by bc.id
       for update
  ) l;

  select count(*) into v_items from public.swap_items where swap_id = p_swap_id;
  if v_items = 0 then
    raise exception 'SWAP_HAS_NO_ITEMS' using errcode = '23514';
  end if;
  if v_locked <> v_items then
    raise exception 'SWAP_ITEM_COPY_MISSING' using errcode = '23503';
  end if;

  ------------- ЗҮЙЛ бүрийн эзэмшил + статусыг ТҮГЖЭЭНИЙ ДАРАА дахин шалгах
  -- offered   = requester-ийн хуулбар → responder руу
  -- requested = responder-ийн хуулбар → requester руу
  perform 1
     from public.swap_items si
     join public.book_copies bc on bc.id = si.book_copy_id
    where si.swap_id = p_swap_id
      and (bc.status <> 'reserved'
        or bc.moderation_status = 'removed'
        or bc.owner_id <> case si.side when 'offered' then v_swap.requester_id
                                       else v_swap.responder_id end)
    limit 1;
  if found then
    raise exception 'OWNERSHIP_OR_STATUS_MISMATCH' using errcode = '23514',
      hint = 'Энэ солилцоон дахь хуулбарын эзэн эсвэл статус өөрчлөгдсөн байна.';
  end if;

  ------- ШИЛЖҮҮЛЭГ + ҮЙЛ ЯВДАЛ нэг statement-д, тиймээс ЗӨРӨХ БОЛОМЖГҮЙ
  with items as (
    select si.book_copy_id,
           bc.owner_id as from_owner,
           case si.side when 'offered' then v_swap.responder_id
                        else v_swap.requester_id end as to_owner
      from public.swap_items si
      join public.book_copies bc on bc.id = si.book_copy_id
     where si.swap_id = p_swap_id
  ),
  moved as (
    update public.book_copies bc
       set owner_id       = i.to_owner,
           custodian_id   = i.to_owner,        -- MVP: custody нь ownership-ийг дагана
           status         = 'swapped',
           transfer_count = bc.transfer_count + 1
      from items i
     where bc.id = i.book_copy_id
    returning bc.id as copy_id, i.from_owner, i.to_owner
  ),
  events as (
    insert into public.ownership_events
      (book_copy_id, from_owner_id, to_owner_id, event_type, swap_id, actor_id, metadata)
    select m.copy_id, m.from_owner, m.to_owner, 'swap_transfer',
           p_swap_id, v_actor, jsonb_build_object('source','complete_swap')
      from moved m
    returning 1
  )
  select count(*) into v_moved from events;

  if v_moved <> v_items then
    raise exception 'TRANSFER_COUNT_MISMATCH' using errcode = '23514';
  end if;

  ------------------------------------------ хамгаалалттай compare-and-set
  update public.swaps
     set status = 'COMPLETED', completed_at = now(), closed_at = now()
   where id = p_swap_id and status = 'CONFIRMED'
  returning * into v_swap;
  if not found then
    raise exception 'SWAP_STATE_CHANGED_CONCURRENTLY' using errcode = '40001';
  end if;

  ------------------------------------------------------- audit + мэдэгдэл
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (v_actor, 'swap.completed', 'swap', p_swap_id::text,
          jsonb_build_object('items', v_items,
                             'requester_id', v_swap.requester_id,
                             'responder_id', v_swap.responder_id));

  insert into public.notifications (user_id, type, entity_type, entity_id)
  select u, 'swap_completed', 'swap', p_swap_id
    from unnest(array[v_swap.requester_id, v_swap.responder_id]) u;

  return v_swap;
end $$;

revoke all     on function public.complete_swap(uuid) from public, anon;
grant  execute on function public.complete_swap(uuid) to authenticated;
```

### 4.3 Мөр мөрөөр нь тайлбар

| Хэсэг | Юу хийж байгаа | Яагаад ийм байх ёстой |
|---|---|---|
| `v_actor := (select auth.uid())` | Дуудагчийн ID-г JWT-ээс авна | Клиентээс ирсэн `userId` параметрт **хэзээ ч** итгэхгүй |
| `AUTH_REQUIRED` шалгалт | Session байгаа эсэх | `SECURITY DEFINER` нь RLS-ийг тойрдог тул authn-аа өөрөө хийнэ |
| `ACCOUNT_NOT_ACTIVE` | Түдгэлзүүлсэн данс | Түдгэлзүүлсэн хэрэглэгч гүйлгээ дуусгах ёсгүй |
| `pg_advisory_xact_lock` | Swap тус бүрээр цуваачлах | Хоёр хүн зэрэг дарахад race үүсэхгүй |
| `for update` (ТҮГЖЭЭ 1) | Swap мөрийг түгжинэ | Дараагийн бүх шалгалт тогтвортой мөр дээр явна |
| `NOT_A_PARTICIPANT` **түгжээний дараа** | Гуравдагч этгээдийг таслана | Түгжээний өмнө шалгавал TOCTOU цонх үлдэнэ |
| `confirmed_by = v_actor` шалгалт | Нэг хүний дангаар дуусгахыг таслана | Brief-ийн "хоёр тал зөвшөөрөх" шаардлагын бүтцийн хэрэгжилт |
| `order by bc.id for update` | Хуулбаруудыг тогтмол дарааллаар түгжинэ | Deadlock-оос сэргийлнэ |
| `v_locked <> v_items` | Түгжсэн тоо = зүйлийн тоо эсэх | Хуулбар устсан/алга болсныг илрүүлнэ |
| Эзэмшил дахин шалгах | Түгжээний дараа эзэн хэвээр эсэх | Хоёр swap нэг номыг хуваалцсан тохиолдол |
| `with items … moved … events` | Нэг statement-д UPDATE + INSERT | Хоёр нь **зөрөх боломжгүй** — statement-ийн дунд алдаа гарвал хоёулаа буцна |
| `v_moved <> v_items` | Бичигдсэн event = зүйлийн тоо | Чимээгүй хагас гүйцэтгэлээс хамгаална |
| `where … and status = 'CONFIRMED'` | Compare-and-set | Зэрэгцээ өөрчлөлтийг чанга `40001` болгоно |

---

## 5. Бүтэлгүйтлийн бүх горим

| Нөхцөл | SQLSTATE | HTTP | Хэрэглэгч юу харах | Дахин оролдох уу |
|---|---|---|---|---|
| Session байхгүй | `28000` | 401 | "Дахин нэвтэрнэ үү." | ❌ |
| Данс түдгэлзүүлсэн | `42501` | 403 | "Таны данс түр хаагдсан байна." | ❌ |
| Swap олдсонгүй | `P0002` | 404 | "Энэ солилцоо олдсонгүй." | ❌ |
| Оролцогч биш | `42501` | 403 | "Танд энэ үйлдлийг хийх эрх байхгүй." | ❌ |
| Буруу төлөв | `23514` | 400 | "Энэ солилцоог одоогийн төлөвт дуусгах боломжгүй." | ❌ |
| Аль хэдийн баталгаажуулсан | `23514` | 400 | "Нөгөө талын баталгаажуулалтыг хүлээж байна." | ❌ |
| Хуулбар алга болсон | `23503` | 409 | "Солилцоон дахь ном олдсонгүй. Хуудсаа шинэчилнэ үү." | ❌ |
| Эзэн/статус зөрсөн | `23514` | 400 | "Ном өөрчлөгдсөн байна. Хуудсаа шинэчилнэ үү." | ❌ |
| Давхар шилжүүлэг | `23505` | 409 | "Энэ солилцоо аль хэдийн дууссан байна." | ❌ |
| CAS уралдаанд ялагдсан | `40001` | 500 | "Түр зуурын алдаа. Дахин оролдоно уу." | ✅ **1 удаа** |
| Deadlock | `40P01` | 500 | адил | ✅ **1 удаа** |

> Хэрэглэгчид **хэзээ ч** PostgreSQL-ийн түүхий алдааны текст харагдахгүй — тэдгээр нь table,
> багана, constraint-ийн нэрийг задруулдаг. `src/features/swaps/errors.ts` дэх `ERROR_MAP` нь
> SQLSTATE-г монгол мессеж рүү хөрвүүлнэ; түүхий алдаа зөвхөн серверийн лог руу очно.

---

## 6. Зэрэгцээ ажиллагааны хувилбарууд

| Хувилбар | Юу болох | Юу сэргийлж байгаа |
|---|---|---|
| **Хоёр хүн зэрэг `complete` дарав** | Advisory lock нэгийг нь хүлээлгэнэ. Эхнийх нь `CONFIRMED` болгоно; хоёр дахь нь `confirmed_by = v_actor` эсэхийг шалгаад өөр хүн бол `COMPLETED` болгоно. | `pg_advisory_xact_lock` + CAS |
| **Нэг хуулбар хоёр swap-д санал болгогдсон** | Эхний swap `ACCEPTED` болоход хуулбар `reserved` болно. Хоёр дахь swap `accept` хийхийг оролдоход `available` биш тул таслагдана. | `respond_to_swap`-ийн статус шалгалт + `FOR UPDATE` |
| **Swap явж байхад хуулбар устгагдав** | Устгах боломжгүй — `book_copies_guard` DELETE-ийг бүрэн хориглоно. `inactive` болгох оролдлого нь нээлттэй swap байгаа тул `COPY_LOCKED_BY_OPEN_SWAP` алдаа өгнө. | Trigger |
| **Давхар дуусгах (retry, replay)** | `ownership_events_one_per_swap_copy` unique index нь `23505` өгнө. Мөн swap аль хэдийн `COMPLETED` тул `swaps_guard` таслана. | Unique index + terminal guard |
| **Дуусгах явцад эзэн өөрчлөгдсөн** | Түгжээний дараах эзэмшлийн дахин шалгалт `OWNERSHIP_OR_STATUS_MISMATCH` өгнө. | Post-lock re-validation |
| **`service_role` key задарсан** | `swaps_guard`, `book_copies_guard`, `solio_deny_mutation` бүгд `BYPASSRLS` role дээр ч ажиллана. Дууссан гүйлгээ, өмчлөлийн түүх хөндөгдөхгүй. | Trigger давхарга |

---

## 7. Transaction-ы ГАДНА байгаа хажуугийн үр дагавар

| Үйлдэл | Хаана | Яагаад гадна байх нь аюулгүй вэ |
|---|---|---|
| Analytics event (`swap_completed`) | `after()` — хариу илгээгдсэний дараа | Алдагдвал бүтээгдэхүүний хэмжилт л дутна, өгөгдөл эвдрэхгүй |
| Email/push (ирээдүйд) | outbox → тусдаа ажилтан | Гуравдагч үйлчилгээ унавал transaction барьцаалагдах ёсгүй |
| R2 объект устгах | `after()` | Файл үлдвэл цэвэрлэгч барина; DB-ийн үнэн зөв нь чухал |
| Cache invalidation (`updateTag`) | Server Action, RPC амжилттай болсны дараа | Амжилтгүй RPC-ийн дараа cache цэвэрлэх шаардлагагүй |

**Transaction-ы ДОТОР заавал байх ёстой зүйлс:** өмчлөл шилжих, `ownership_events`,
`swaps.status`, `book_copies.status`, `audit_logs`, `notifications`. Эдгээрийн аль нэг нь
бүтэлгүйтвэл бүгд буцах ёстой — тухайлбал *"өмчлөл шилжсэн ч ownership event бичигдээгүй"*
гэсэн төлөв **хэзээ ч** үүсэхгүй.

---

## 8. Шалгагдсан тестийн үр дүн

Дараах тестүүд PostgreSQL 17 (локал Supabase stack) дээр бодитоор ажиллаж, доорх үр дүнг өгсөн.
Эдгээр нь `supabase/tests/swap_completion.test.sql` (pgTAP) болгон хөрвүүлэгдэнэ.

**Тавьсан хувилбар:** Алтан `The Hobbit`-ийг, Болд `Монголын нууц товчоо`-г эзэмшинэ.
Алтан солилцооны хүсэлт илгээж, Болд хүлээн авсан (`ACCEPTED`, хоёр хуулбар `reserved`).

| Тест | Үйлдэл | Хүлээгдсэн | Бодит үр дүн |
|---|---|---|---|
| **A** | Халдагч (оролцогч биш) `complete_swap` дуудав | таслагдана | ✅ `NOT_A_PARTICIPANT (42501)` |
| **B** | Алтан баталгаажуулав (PHASE 1) | `CONFIRMED` | ✅ `status=CONFIRMED confirmed_by=Алтан` |
| **C** | Алтан **дахин** дуудав (дангаараа дуусгах) | таслагдана | ✅ `AWAITING_COUNTERPARTY_CONFIRMATION (23514)` |
| **D** | Болд баталгаажуулав (PHASE 2) | `COMPLETED` | ✅ `status=COMPLETED completed_at=…` |
| **E** | Дууссаны дараа дахин дуудав | таслагдана | ✅ `INVALID_TRANSITION_COMPLETED_TO_COMPLETED` |
| **F₁** | `ownership_events` мөр UPDATE хийв | таслагдана | ✅ `TABLE_IS_APPEND_ONLY: ownership_events (42501)` |
| **F₂** | `ownership_events` мөр DELETE хийв | таслагдана | ✅ `TABLE_IS_APPEND_ONLY: ownership_events (42501)` |
| **G** | Бүрэн бүтэн байдлын query | 0 мөр | ✅ 0 мөр |

**Өмчлөлийн эцсийн байдал:**

```
                  id                  | owner | status  | transfer_count
--------------------------------------+-------+---------+----------------
 aaaaaaaa-…-000000000001 (The Hobbit) | Болд  | swapped |              1
 bbbbbbbb-…-000000000001 (Нууц товчоо)| Алтан | swapped |              1
```

**`ownership_events` гинж:**

```
             book_copy_id             | from_owner | to_owner |      event_type
--------------------------------------+------------+----------+----------------------
 aaaaaaaa-…-000000000001              | (NULL)     | Алтан    | initial_registration
 bbbbbbbb-…-000000000001              | (NULL)     | Болд     | initial_registration
 aaaaaaaa-…-000000000001              | Алтан      | Болд     | swap_transfer
 bbbbbbbb-…-000000000001              | Болд       | Алтан    | swap_transfer
```

> **Тэмдэглэл — F тест яагаад чухал вэ:** энэ тест `postgres` role-оор ажилласан. Өөрөөр хэлбэл
> хамгийн өндөр эрхтэй холболт ч өмчлөлийн түүхийг өөрчилж чадаагүй. RLS дангаараа үүнийг
> хийж чадахгүй байсан — trigger давхарга л үүнийг барьсан.

---

## 9. Өмчлөл өөрчлөх дүрэм

1. `book_copies.owner_id`-г бичдэг **цорын ганц** код бол `public.complete_swap()` болон
   `public.admin_correct_ownership()` (админ маргаан шийдвэрлэх, заавал шалтгаан бичнэ).
2. `book_copies_guard` trigger нь privileged context-ээс гадуур ирсэн `owner_id`/`custodian_id`
   өөрчлөлтийг **бүгдийг** таслана.
3. `authenticated` role-д `book_copies`-ийн `owner_id` багана дээр UPDATE эрх байхгүй.
4. Өмчлөл өөрчлөгдөх болгонд `ownership_events` мөр **заавал** нэг statement-д хамт бичигдэнэ.
5. `ownership_events` нь зөвхөн нэмэгддэг — UPDATE, DELETE, TRUNCATE бүгд trigger-ээр хаагдсан.
6. Хэрэглэгч номоо "устгах" үед физик мөр устгагдахгүй — `status='inactive'` болно.
   Өмчлөлийн түүх хэвээр үлдэнэ (brief §33).
