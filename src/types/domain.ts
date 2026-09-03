/**
 * Domain types for the Solio UI layer.
 *
 * These mirror the database schema documented in docs/database.md. Value lists
 * are declared here once so the UI and (later) the Zod schemas share a single
 * source of truth — the DB stores them as DOMAIN-constrained text, which
 * `supabase gen types` widens to `string`.
 */

export const BOOK_CONDITION = ['new', 'like_new', 'good', 'fair', 'poor'] as const
export type BookCondition = (typeof BOOK_CONDITION)[number]

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
  eventType: 'initial_registration' | 'swap_transfer' | 'admin_correction'
  occurredAt: string
}

