-- ═══════════════════════════════════════════════════════════════════════════
--  DEVELOPMENT SEED — never runs against production.
--  `supabase db push` deploys migrations only; this file is applied by
--  `supabase db reset` / `supabase start` on the local stack.
--
--  Demo accounts use the RFC-2606 reserved TLD .invalid (cannot be registered)
--  and every demo bio starts with [DEMO], so seeded rows are unmistakable.
--  All demo passwords: demo1234
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if current_setting('app.environment', true) = 'production' then
    raise exception 'SEED_DATA_MUST_NEVER_RUN_IN_PRODUCTION';
  end if;
end $$;

-- Profiles and default roles are created by the on_auth_user_created trigger.
-- GoTrue scans the *_token columns into Go strings and cannot handle NULL,
-- so they must be empty strings rather than left to default.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token,
                        email_change_token_new, email_change,
                        email_change_token_current, phone_change,
                        phone_change_token, reauthentication_token)
values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','altan@example.invalid',
  extensions.crypt('demo1234', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"altan","display_name":"Алтан"}',
  '', '', '', '', '', '', '', ''),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','bolor@example.invalid',
  extensions.crypt('demo1234', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"bolor","display_name":"Болор"}',
  '', '', '', '', '', '', '', ''),
 ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ganbat@example.invalid',
  extensions.crypt('demo1234', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"ganbat","display_name":"Ганбат"}',
  '', '', '', '', '', '', '', ''),
 ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','dulmaa@example.invalid',
  extensions.crypt('demo1234', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"dulmaa","display_name":"Дулмаа"}',
  '', '', '', '', '', '', '', ''),
 ('55555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','admin_demo@example.invalid',
  extensions.crypt('demo1234', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"admin_demo","display_name":"Админ"}',
  '', '', '', '', '', '', '', ''),
 ('66666666-6666-6666-6666-666666666666','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','mod_demo@example.invalid',
  extensions.crypt('demo1234', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"mod_demo","display_name":"Модератор"}',
  '', '', '', '', '', '', '', '');

insert into auth.identities (id, user_id, provider_id, provider, identity_data,
                             created_at, updated_at, last_sign_in_at)
select u.id, u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
  from auth.users u where u.email like '%@example.invalid';

update public.profiles set
  bio = '[DEMO] ' || case username
          when 'altan'  then 'Түүх, намтар голчилж уншдаг.'
          when 'bolor'  then 'Уран зохиол, орчуулгын ном цуглуулдаг.'
          when 'ganbat' then 'Технологи, бизнесийн ном.'
          else 'Хүүхдийн ном, зурагт ном.' end,
  city = case username when 'ganbat' then 'Дархан'
                       when 'dulmaa' then 'Эрдэнэт' else 'Улаанбаатар' end
 where id in ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222',
              '33333333-3333-3333-3333-333333333333',
              '44444444-4444-4444-4444-444444444444');

-- Demo library. Inserted directly (as postgres) rather than through the RPC so
-- the seed can pick owners and back-date rows.
with new_books as (
  insert into public.books (title, author, isbn, publisher, language, description,
                            published_at, created_by, created_at)
  values
   ('Монголын нууц товчоо','Тодорхойгүй','9789992901234','Улсын хэвлэлийн газар','mn',
    'XIII зууны Монголын түүхэн сурвалж. Чингис хааны удам угсаа, амьдрал, байлдан дагуулалтын тухай өгүүлдэг.',
    '2019-01-01','22222222-2222-2222-2222-222222222222', now() - interval '5 days'),
   ('Ном унших урлаг','Мортимер Адлер','9780671212094','Нэпко','mn',
    'Хэрхэн гүнзгий, ойлгомжтой унших вэ гэдгийг заасан сонгодог гарын авлага.',
    '2021-06-15','11111111-1111-1111-1111-111111111111', now() - interval '6 days'),
   ('The Hobbit','J.R.R. Tolkien','9780261102217','HarperCollins','en',
    'Bilbo Baggins is swept into a quest to reclaim the lost Dwarf Kingdom of Erebor.',
    '2012-09-18','11111111-1111-1111-1111-111111111111', now() - interval '7 days'),
   ('Зөгийн балны амт','Д. Дулмаа',null,'Мөнхийн үсэг','mn',
    'Хөдөөгийн бага насны дурсамжийг өгүүлсэн хүүхдийн богино өгүүллэгүүд.',
    '2023-03-10','44444444-4444-4444-4444-444444444444', now() - interval '8 days'),
   ('Хүн ба хувь заяа','Ч. Лодойдамба','9789996252341','Соёмбо принтинг','mn',
    'Монголын сонгодог уран зохиолын нэгэн чухал бүтээл.',
    '2018-11-02','22222222-2222-2222-2222-222222222222', now() - interval '9 days'),
   ('Sapiens: Хүн төрөлхтний товч түүх','Ювал Ноа Харари','9789997712349','Нэпко','mn',
    'Танин мэдэхүйн хувьсгалаас өнөөг хүртэлх хүн төрөлхтний түүх.',
    '2020-02-20','33333333-3333-3333-3333-333333333333', now() - interval '10 days'),
   ('Номын сан ба уншлагын соёл','Б. Батсайхан',null,'Соёмбо','mn',
    'Монгол дахь номын сангийн хөгжил, уншлагын соёлын судалгаа.',
    '2022-09-01','22222222-2222-2222-2222-222222222222', now() - interval '11 days'),
   ('Atomic Habits','James Clear','9780735211292','Avery','en',
    'An easy and proven way to build good habits and break bad ones.',
    '2018-10-16','33333333-3333-3333-3333-333333333333', now() - interval '12 days'),
   ('Гэгээн муза','Б. Явуухулан',null,'Улсын хэвлэлийн газар','mn',
    'Монголын нэрт яруу найрагчийн шүлгийн түүвэр.',
    '2015-04-04','11111111-1111-1111-1111-111111111111', now() - interval '13 days'),
   ('Clean Code','Robert C. Martin','9780132350884','Prentice Hall','en',
    'A handbook of agile software craftsmanship.',
    '2008-08-01','33333333-3333-3333-3333-333333333333', now() - interval '14 days')
  returning id, title
)
insert into public.book_copies (book_id, owner_id, custodian_id, condition,
                                condition_note, status, created_at)
select b.id, o.owner, o.owner, o.cond, o.note, o.st, now() - (o.age || ' days')::interval
  from new_books b
  join (values
    ('Монголын нууц товчоо','22222222-2222-2222-2222-222222222222'::uuid,'good','Хавтас бага зэрэг элэгдэлтэй, дотор нь цэвэрхэн.','available',5),
    ('Монголын нууц товчоо','33333333-3333-3333-3333-333333333333'::uuid,'fair','Хэдэн хуудсанд тэмдэглэгээ бий.','available',4),
    ('Ном унших урлаг','11111111-1111-1111-1111-111111111111'::uuid,'like_new','Нэг удаа уншсан.','available',6),
    ('The Hobbit','11111111-1111-1111-1111-111111111111'::uuid,'good',null,'available',7),
    ('Зөгийн балны амт','44444444-4444-4444-4444-444444444444'::uuid,'new','Огт уншаагүй.','available',8),
    ('Хүн ба хувь заяа','22222222-2222-2222-2222-222222222222'::uuid,'good',null,'available',9),
    ('Sapiens: Хүн төрөлхтний товч түүх','33333333-3333-3333-3333-333333333333'::uuid,'like_new',null,'available',10),
    ('Номын сан ба уншлагын соёл','22222222-2222-2222-2222-222222222222'::uuid,'good',null,'available',11),
    ('Atomic Habits','33333333-3333-3333-3333-333333333333'::uuid,'new',null,'available',12),
    ('Гэгээн муза','11111111-1111-1111-1111-111111111111'::uuid,'poor','Хуучирсан, гэхдээ бүрэн бүтэн.','inactive',13),
    ('Clean Code','33333333-3333-3333-3333-333333333333'::uuid,'good',null,'available',14)
  ) as o(title, owner, cond, note, st, age) on o.title = b.title;

-- ── Demo records ──────────────────────────────────────────────────────────
-- Vinyl exists in the catalogue the moment a second kind was added, and a seed
-- with only books hides every place that assumes one. Three of them, with the
-- per-kind attributes filled in, so the detail page and the square cover both
-- have something real to render.
with new_vinyl as (
  insert into public.books (title, author, publisher, language, description,
                            published_at, kind, categories, attributes,
                            created_by, created_at)
  values
   ('Kind of Blue','Miles Davis','Columbia','en',
    'Жаазны түүхэн дэх хамгийн их борлуулалттай цомог. 1959 оны бичлэг.',
    '1959-08-17','vinyl', array['jazz']::public.book_category[],
    '{"rpm": 33, "disc_size": "12", "track_count": 5}'::jsonb,
    '11111111-1111-1111-1111-111111111111', now() - interval '3 days'),
   ('Алтан загас','Хар сарнай','Ардын хэвлэл','mn',
    'Монголын рок хөгжмийн сонгодог цомог, анхны хэвлэл.',
    '1994-05-01','vinyl', array['rock','mongolian']::public.book_category[],
    '{"rpm": 33, "disc_size": "12", "track_count": 10}'::jsonb,
    '22222222-2222-2222-2222-222222222222', now() - interval '4 days'),
   ('Abbey Road','The Beatles','Apple Records','en',
    '1969 оны цомог. Хавтас нь бага зэрэг элэгдэлтэй, пянз нь цэвэрхэн.',
    '1969-09-26','vinyl', array['rock','pop']::public.book_category[],
    '{"rpm": 33, "disc_size": "12", "track_count": 17}'::jsonb,
    '33333333-3333-3333-3333-333333333333', now() - interval '6 days')
  returning id, title
)
insert into public.book_copies (book_id, owner_id, custodian_id, condition,
                                condition_note, status, created_at)
select v.id, o.owner, o.owner, o.cond, o.note, 'available', now() - (o.age || ' days')::interval
  from new_vinyl v
  join (values
    ('Kind of Blue','11111111-1111-1111-1111-111111111111'::uuid,'good',
     'Хавтас нь бага зэрэг цайсан, пянз дээр зураас алга.',3),
    ('Алтан загас','22222222-2222-2222-2222-222222222222'::uuid,'fair',
     'Хоёр дуун дээр бага зэрэг шаржигнана.',4),
    ('Abbey Road','33333333-3333-3333-3333-333333333333'::uuid,'like_new',null,6)
  ) as o(title, owner, cond, note, age) on o.title = v.title;

-- Every copy needs the opening entry of its ownership chain.
insert into public.ownership_events (book_copy_id, from_owner_id, to_owner_id,
                                     event_type, actor_id, occurred_at)
select c.id, null, c.owner_id, 'initial_registration', c.owner_id, c.created_at
  from public.book_copies c;

-- ── Demo swaps, one per interesting state ─────────────────────────────────
-- Inserted directly (as postgres) so each can be parked in a specific state;
-- the RPCs are what create them in the running app.
with picks as (
  select
    (select c.id from public.book_copies c join public.books b on b.id=c.book_id
      where c.owner_id='22222222-2222-2222-2222-222222222222' and b.title='Монголын нууц товчоо') as bolor_nuuts,
    (select c.id from public.book_copies c join public.books b on b.id=c.book_id
      where c.owner_id='11111111-1111-1111-1111-111111111111' and b.title='The Hobbit') as altan_hobbit,
    (select c.id from public.book_copies c join public.books b on b.id=c.book_id
      where c.owner_id='11111111-1111-1111-1111-111111111111' and b.title='Ном унших урлаг') as altan_nom,
    (select c.id from public.book_copies c join public.books b on b.id=c.book_id
      where c.owner_id='33333333-3333-3333-3333-333333333333' and b.title='Sapiens: Хүн төрөлхтний товч түүх') as ganbat_sapiens
),
s1 as (
  insert into public.swaps (id, requester_id, responder_id, status, message, created_at)
  values ('7a1c93e4-5d2b-4f18-9c60-3e8b1d47a201',
          '22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',
          'REQUESTED','Сайн байна уу? The Hobbit-ийг тань авмаар байна.', now() - interval '1 day')
  returning id
),
s2 as (
  insert into public.swaps (id, requester_id, responder_id, status, message, created_at)
  values ('7a1c93e4-5d2b-4f18-9c60-3e8b1d47a202',
          '11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333',
          'ACCEPTED','Sapiens-ийг солилцох уу?', now() - interval '3 days')
  returning id
)
insert into public.swap_items (swap_id, book_copy_id, side)
select '7a1c93e4-5d2b-4f18-9c60-3e8b1d47a201'::uuid, bolor_nuuts,    'offered'   from picks
union all
select '7a1c93e4-5d2b-4f18-9c60-3e8b1d47a201'::uuid, altan_hobbit,   'requested' from picks
union all
select '7a1c93e4-5d2b-4f18-9c60-3e8b1d47a202'::uuid, altan_nom,      'offered'   from picks
union all
select '7a1c93e4-5d2b-4f18-9c60-3e8b1d47a202'::uuid, ganbat_sapiens, 'requested' from picks;

-- The ACCEPTED swap's copies must be reserved, matching what respond_to_swap does.
update public.book_copies set status = 'reserved'
 where id in (select book_copy_id from public.swap_items
               where swap_id = '7a1c93e4-5d2b-4f18-9c60-3e8b1d47a202'::uuid);

insert into public.notifications (user_id, type, entity_type, entity_id)
values ('11111111-1111-1111-1111-111111111111','swap_requested','swap','7a1c93e4-5d2b-4f18-9c60-3e8b1d47a201'),
       ('33333333-3333-3333-3333-333333333333','swap_accepted','swap','7a1c93e4-5d2b-4f18-9c60-3e8b1d47a202');

-- ── Demo wishlist ─────────────────────────────────────────────────────────
-- One entry against a work that exists (so the page shows the linked state)
-- and one free-text entry for a book nobody has listed yet.
insert into public.book_requests (user_id, title, author, note)
values ('11111111-1111-1111-1111-111111111111', 'Clean Code', 'Robert C. Martin',
        'Англи эх хувилбар байвал сайн.');

insert into public.book_requests (user_id, title, author, note)
values ('11111111-1111-1111-1111-111111111111',
        'Монголын нууц товчооны тайлбар', 'Ц. Дамдинсүрэн', 'Аль ч хэвлэл болно.');

-- ── Staff roles and a demo report ─────────────────────────────────────────
-- Two staff accounts so the difference between them is visible: a moderator
-- can hide content, only an admin can change roles.
insert into public.user_roles (user_id, role) values
  ('55555555-5555-5555-5555-555555555555','admin'),
  ('66666666-6666-6666-6666-666666666666','moderator');

update public.profiles set bio = '[DEMO] Платформын админ', city = 'Улаанбаатар'
 where id = '55555555-5555-5555-5555-555555555555';
update public.profiles set bio = '[DEMO] Контент модератор', city = 'Улаанбаатар'
 where id = '66666666-6666-6666-6666-666666666666';

insert into public.reports (reporter_id, entity_type, entity_id, reason, detail)
select '22222222-2222-2222-2222-222222222222', 'book', b.id, 'wrong_metadata',
       'Зохиогчийн нэр буруу бичигдсэн байна.'
  from public.books b where b.title = 'Гэгээн муза';

-- ── Demo comments ─────────────────────────────────────────────────────────
-- Comments hang off a listing, not a catalogue row, so each one is attached to
-- somebody's actual book (ADR-031).
insert into public.comments (book_copy_id, user_id, body)
select c.id, v.user_id, v.body
  from public.book_copies c
  join public.books b on b.id = c.book_id
  join (values
    ('Монголын нууц товчоо','11111111-1111-1111-1111-111111111111'::uuid,
     'Монгол хүн бүр нэг удаа уншвал зохих ном. Орчуулга нь ойлгомжтой.'),
    ('Ном унших урлаг','22222222-2222-2222-2222-222222222222'::uuid,
     'Уншлагын арга барилаа бүрэн өөрчилсөн.'),
    ('The Hobbit','44444444-4444-4444-4444-444444444444'::uuid,
     'Timeless. Гурав дахь удаагаа уншиж байна.'),
    ('Atomic Habits','22222222-2222-2222-2222-222222222222'::uuid,
     'Практик зөвлөгөө их.')
  ) as v(title, user_id, body) on v.title = b.title
 where c.owner_id is distinct from v.user_id
   and c.id = (select c2.id from public.book_copies c2
                where c2.book_id = b.id order by c2.created_at limit 1);

-- ── Demo storage points ───────────────────────────────────────────────────
-- Two venues, because one of everything hides the questions a list has to
-- answer: they sort by city, and a listing has to say which of them holds it.
-- Created through the same signup metadata a real café goes through, so the
-- trigger that builds the premises row is exercised by every reset.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token,
                        email_change_token_new, email_change,
                        email_change_token_current, phone_change,
                        phone_change_token, reauthentication_token)
values
 ('77777777-7777-7777-7777-777777777777','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','nomyn_kafe@example.invalid',
  extensions.crypt('demo1234', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"nomyn_kafe","account_type":"storage_point",
    "sp_name":"Номын Кафе","sp_kind":"cafe",
    "sp_city":"Улаанбаатар","sp_district":"Сүхбаатар дүүрэг",
    "sp_address":"1-р хороо, Сеулын гудамж 12, Оргил төв, 1 давхар",
    "sp_landmark":"Улсын номын сангийн урд талд",
    "sp_phone":"9911 2233","sp_hours":"Даваа–Баасан 09:00–21:00, Бямба 10:00–18:00",
    "sp_capacity":"150","sp_website":"https://example.invalid/nomynkafe",
    "sp_description":"[DEMO] Кафены хоёрдугаар давхарт номын тавиур бий. Ирж уншиж болно."}',
  '', '', '', '', '', '', '', ''),
 ('88888888-8888-8888-8888-888888888888','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','erdenet_nomin@example.invalid',
  extensions.crypt('demo1234', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"erdenet_nomin","account_type":"storage_point",
    "sp_name":"Эрдэнэт Номын Сан","sp_kind":"library",
    "sp_city":"Эрдэнэт","sp_district":"Баянөндөр сум",
    "sp_address":"4-р баг, Соёлын ордны баруун жигүүр",
    "sp_phone":"7035 4400","sp_hours":"Даваа–Бямба 10:00–19:00",
    "sp_capacity":"400",
    "sp_description":"[DEMO] Номын сангийн бүртгэлээр хадгална."}',
  '', '', '', '', '', '', '', '');

insert into auth.identities (id, user_id, provider_id, provider, identity_data,
                             created_at, updated_at, last_sign_in_at)
select u.id, u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
  from auth.users u
 where u.id in ('77777777-7777-7777-7777-777777777777',
                '88888888-8888-8888-8888-888888888888');

-- Three books are already sitting on somebody else's shelf. Each is left with a
-- venue in the owner's own city, because that is the only arrangement that
-- makes sense in practice and demo data that reads as implausible gets trusted
-- less than none. Written directly rather than through set_stored_at(), which
-- reads auth.uid() and has no session here.
update public.book_copies c set
  stored_at = (select id from public.storage_points where name = v.venue),
  stored_since = now() - v.ago
 from (values
   ('22222222-2222-2222-2222-222222222222'::uuid, 'Монголын нууц товчоо',
    'Номын Кафе', interval '9 days'),
   ('11111111-1111-1111-1111-111111111111'::uuid, 'The Hobbit',
    'Номын Кафе', interval '3 days'),
   ('44444444-4444-4444-4444-444444444444'::uuid, 'Зөгийн балны амт',
    'Эрдэнэт Номын Сан', interval '21 days')
 ) as v(owner_id, title, venue, ago)
 join public.books b on b.title = v.title
 where c.owner_id = v.owner_id and c.book_id = b.id;
