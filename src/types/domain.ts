/**
 * Domain types for the Solio UI layer.
 *
 * These mirror the database schema documented in docs/database.md. Value lists
 * are declared here once so the UI and (later) the Zod schemas share a single
 * source of truth — the DB stores them as DOMAIN-constrained text, which
 * `supabase gen types` widens to `string`.
 */

/**
 * What a listing is. One catalogue table holds both, because the transaction —
 * one person's copy, offered, handed over, its history following the copy — is
 * identical; only the description differs.
 */
export const ITEM_KIND = ['book', 'vinyl'] as const
export type ItemKind = (typeof ITEM_KIND)[number]

/**
 * What to call a listing when the kind is not known — a mixed feed, an empty
 * state, the name of a page that holds both. Naming the kinds is clearer than
 * an abstract noun while there are only two of them; when a third arrives this
 * is the one line that changes.
 */
export const ITEMS_LABEL = 'Ном, пянз'
export const ITEMS_LABEL_LOWER = 'ном, пянз'

/**
 * The words each kind uses for the same slot in the form and on the card.
 *
 * `of` is spelt out rather than glued together from `one` — Mongolian genitive
 * endings do not follow from the nominative reliably enough to build them in
 * code, and "Номы" is what you get when you try.
 */
export const KIND_COPY: Record<
  ItemKind,
  { one: string; of: string; own: string; add: string; title: string; author: string; publisher: string }
> = {
  book: {
    one: 'Ном',
    of: 'Номын',
    own: 'номныхоо',
    add: 'Ном нэмэх',
    title: 'Номын нэр',
    author: 'Зохиогч',
    publisher: 'Хэвлэлийн газар',
  },
  vinyl: {
    one: 'Пянз',
    of: 'Пянзны',
    own: 'пянзныхаа',
    add: 'Пянз нэмэх',
    title: 'Цомгийн нэр',
    author: 'Дуучин / хамтлаг',
    publisher: 'Лейбл',
  },
}

/**
 * The fields that belong to one kind and are only ever displayed.
 *
 * They live in `books.attributes`, a jsonb column, rather than in columns of
 * their own — see the migration for the measurements behind that. This list is
 * the client half of the same spec the database enforces in
 * private.item_attribute_spec: adding a kind means a branch here and a branch
 * there, and no column, parameter or type anywhere.
 *
 * The form renders from it and the detail page reads from it, so a new field
 * appears in both the moment it is added here.
 */
export type AttributeSpec = {
  key: string
  label: string
  /** `enum` renders a <select>, `int` a number box, `text` a text box. */
  type: 'int' | 'enum' | 'text'
  options?: readonly (string | number)[]
  min?: number
  max?: number
  placeholder?: string
  /** How the value reads on the detail page — "33 rpm", "12″". */
  suffix?: string
}

export const ATTRIBUTES_FOR: Record<ItemKind, readonly AttributeSpec[]> = {
  book: [
    { key: 'page_count', label: 'Нүүрний тоо', type: 'int', min: 1, max: 20000, placeholder: '320' },
  ],
  vinyl: [
    { key: 'rpm', label: 'Эргэлт', type: 'enum', options: [33, 45, 78], suffix: ' rpm' },
    { key: 'disc_size', label: 'Диаметр', type: 'enum', options: ['7', '10', '12'], suffix: '″' },
    { key: 'track_count', label: 'Дууны тоо', type: 'int', min: 1, max: 200, placeholder: '12' },
  ],
}

export const BOOK_CONDITION = ['new', 'like_new', 'good', 'fair', 'poor'] as const
export type BookCondition = (typeof BOOK_CONDITION)[number]

/**
 * Ordered as the picker and the category strip show them: kinds of story first,
 * then subjects, then the practical shelves. Twelve headings sent most books to
 * "бусад", which is a filter that tells you nothing.
 *
 * The same list is a CHECK on public.book_category — a value added here without
 * the migration is refused by the database.
 */
export const BOOK_CATEGORY = [
  'fiction', 'classic', 'poetry', 'drama', 'detective', 'scifi', 'fantasy', 'comics',
  'nonfiction', 'biography', 'history', 'science', 'nature', 'technology', 'medicine',
  'religion', 'politics', 'law', 'business',
  'selfhelp', 'psychology', 'parenting', 'cooking', 'travel', 'sport', 'art',
  'children', 'textbook', 'language', 'reference', 'other',
] as const

/**
 * Music genres. The same database domain holds both lists — a category is a
 * category — and the picker shows the one that belongs to the kind being added.
 */
export const VINYL_CATEGORY = [
  'rock', 'pop', 'jazz', 'classical', 'folk', 'mongolian', 'hiphop', 'electronic',
  'blues', 'metal', 'country', 'soundtrack', 'world', 'other',
] as const

export const CATEGORIES_FOR: Record<ItemKind, readonly string[]> = {
  book: BOOK_CATEGORY,
  vinyl: VINYL_CATEGORY,
}

export type BookCategory =
  | (typeof BOOK_CATEGORY)[number]
  | (typeof VINYL_CATEGORY)[number]

/** How many headings one book may carry. Mirrors books_categories_len. */
export const BOOK_CATEGORY_MAX = 5

export const COPY_STATUS = ['available', 'reserved', 'swapped', 'inactive'] as const
export type CopyStatus = (typeof COPY_STATUS)[number]

export const SWAP_STATUS = [
  'REQUESTED',
  'ACCEPTED',
  'CONFIRMED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const
export type SwapStatus = (typeof SWAP_STATUS)[number]

export const REQUEST_STATUS = ['open', 'fulfilled', 'cancelled'] as const
export type RequestStatus = (typeof REQUEST_STATUS)[number]

/** Mongolian labels for enum values — the DB never stores these. */
export const CONDITION_LABEL: Record<BookCondition, string> = {
  new: 'Шинэ',
  like_new: 'Шинэтэй адил',
  good: 'Сайн',
  fair: 'Дунд',
  poor: 'Муу',
}

export const CATEGORY_LABEL: Record<BookCategory, string> = {
  fiction: 'Уран зохиол',
  classic: 'Классик',
  poetry: 'Яруу найраг',
  drama: 'Драм, жүжиг',
  detective: 'Детектив, триллер',
  scifi: 'Шинжлэх ухааны зөгнөлт',
  fantasy: 'Фантастик',
  comics: 'Комик, манга',
  nonfiction: 'Танин мэдэхүй',
  biography: 'Намтар, дурсамж',
  history: 'Түүх',
  science: 'Шинжлэх ухаан',
  nature: 'Байгаль, амьтан',
  technology: 'Технологи, программчлал',
  medicine: 'Эрүүл мэнд',
  religion: 'Шашин, философи',
  politics: 'Улс төр',
  law: 'Эрх зүй',
  business: 'Бизнес, эдийн засаг',
  selfhelp: 'Хувь хүний хөгжил',
  psychology: 'Сэтгэл судлал',
  parenting: 'Хүүхэд хүмүүжил',
  cooking: 'Хоол, ундаа',
  travel: 'Аялал',
  sport: 'Спорт',
  art: 'Урлаг',
  children: 'Хүүхдийн',
  textbook: 'Сурах бичиг',
  language: 'Гадаад хэл',
  reference: 'Толь бичиг, лавлах',
  rock: 'Рок',
  pop: 'Поп',
  jazz: 'Жааз',
  classical: 'Сонгодог хөгжим',
  folk: 'Ардын дуу',
  mongolian: 'Монгол хөгжим',
  hiphop: 'Хип хоп, рэп',
  electronic: 'Электрон',
  blues: 'Блюз',
  metal: 'Метал',
  country: 'Кантри',
  soundtrack: 'Кино хөгжим',
  world: 'Дэлхийн хөгжим',
  other: 'Бусад',
}

export const COPY_STATUS_LABEL: Record<CopyStatus, string> = {
  available: 'Боломжтой',
  reserved: 'Захиалагдсан',
  swapped: 'Солилцсон',
  inactive: 'Идэвхгүй',
}

export const SWAP_STATUS_LABEL: Record<SwapStatus, string> = {
  REQUESTED: 'Хүсэлт илгээсэн',
  ACCEPTED: 'Хүлээн авсан',
  CONFIRMED: 'Баталгаажсан',
  COMPLETED: 'Дууссан',
  REJECTED: 'Татгалзсан',
  CANCELLED: 'Цуцалсан',
}

export type Profile = {
  id: string
  username: string
  displayName: string
  bio: string | null
  city: string | null
  avatarUrl: string | null
  joinedAt: string
}

export type Book = {
  id: string
  title: string
  author: string | null
  isbn: string | null
  publisher: string | null
  language: string | null
  description: string | null
  publishedAt: string | null
  coverColor: string
  /** Null until an image has been uploaded and verified. */
  coverUrl: string | null
  createdAt: string
}

export type BookCopy = {
  id: string
  bookId: string
  ownerId: string
  condition: BookCondition
  conditionNote: string | null
  status: CopyStatus
  transferCount: number
  createdAt: string
}

/** A plain comment on a listing's book. No score — see ADR-031. */
export type Comment = {
  id: string
  bookId: string
  userId: string
  body: string
  createdAt: string
}

export type BookRequest = {
  id: string
  userId: string
  bookId: string | null
  title: string
  author: string | null
  note: string | null
  status: RequestStatus
  createdAt: string
}

/**
 * An account is either a person or a place that holds things for people.
 *
 * A storage point is not a separate table: it signs in, gets reported,
 * moderated and linked to exactly like anybody else, and what it adds is a row
 * of premises — an address, opening hours, a telephone. Everything about the
 * distinction that the UI needs is here.
 */
export const ACCOUNT_TYPE = ['person', 'storage_point'] as const
export type AccountType = (typeof ACCOUNT_TYPE)[number]

export const STORAGE_POINT_KIND = [
  'cafe',
  'library',
  'bookstore',
  'coworking',
  'school',
  'other',
] as const
export type StoragePointKind = (typeof STORAGE_POINT_KIND)[number]

export const STORAGE_POINT_KIND_LABEL: Record<StoragePointKind, string> = {
  cafe: 'Кафе',
  library: 'Номын сан',
  bookstore: 'Номын дэлгүүр',
  coworking: 'Хамтран ажиллах орчин',
  school: 'Сургууль',
  other: 'Бусад',
}

/** The premises, as every page that shows one needs them. */
export type StoragePoint = {
  id: string
  /** The profile it belongs to — its page lives at /u/<username>. */
  username: string
  name: string
  kind: StoragePointKind
  city: string
  district: string
  address: string
  landmark: string | null
  phone: string
  hours: string
  capacity: number | null
  website: string | null
  description: string | null
}

/** What a listing says about where it physically is, when it is not at home. */
export type StoredAt = {
  id: string
  username: string
  name: string
  kind: StoragePointKind
  city: string
  district: string
  address: string
  since: string
}

export type SwapItem = {
  copyId: string
  side: 'offered' | 'requested'
}

export type Swap = {
  id: string
  requesterId: string
  responderId: string
  status: SwapStatus
  confirmedBy: string | null
  message: string | null
  createdAt: string
  items: SwapItem[]
}

export type OwnershipEvent = {
  id: number
  copyId: string
  fromOwnerId: string | null
  toOwnerId: string
  eventType: 'initial_registration' | 'swap_transfer' | 'claim_transfer' | 'admin_correction'
  occurredAt: string
}

