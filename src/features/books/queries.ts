import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import type { BookListing, BookCondition, CopyStatus } from '@/types/domain'

/**
 * Read side of the books feature. Every query runs as the caller, so RLS —
 * not a WHERE clause here — is what keeps hidden rows hidden.
 */

type BookRow = {
  id: string
  title: string
  author: string | null
  isbn: string | null
  publisher: string | null
  language: string | null
  description: string | null
  published_at: string | null
  created_at: string
  book_copies: {
    id: string
    status: CopyStatus
    book_images: { storage_key: string; sort_order: number; status: string }[]
  }[]
  book_reviews: { rating: number }[]
}

/**
 * Deterministic cover colour so a book looks the same everywhere.
 *
 * FNV-1a rather than the usual `hash*31 + c`: UUIDs share a fixed layout and
 * alphabet, and the weak hash clustered several books onto the same swatch.
 */
export function coverColorFor(id: string): string {
  // Covers echo the brand palette so the book shelf reads as one family,
  // with a couple of neutral bookish tones for variety.
  const palette = [
    '#e76f51', '#f4a261', '#e9c46a', '#b8860b', '#a44a3f',
    '#5d4a3b', '#8a5a3b', '#4a6b5a', '#b56a54', '#c9a35f',
  ]
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return palette[hash % palette.length]
}

const LIST_SELECT = `
  id, title, author, isbn, publisher, language, description, published_at, created_at,
  book_copies ( id, status, book_images ( storage_key, sort_order, status ) ),
  book_reviews ( rating )
`

/**
 * The cover is a projection, not a stored fact: the primary image of an
 * available copy, preferred, else any ready image. A moderator hiding one copy
 * silently promotes the next candidate with no data migration.
 */
function coverUrlFrom(copies: BookRow['book_copies']): string | null {
  const ready = (c: BookRow['book_copies'][number]) =>
    (c.book_images ?? []).filter((i) => i.status === 'ready').sort((a, b) => a.sort_order - b.sort_order)
  const preferred = copies.find((c) => c.status === 'available' && ready(c).length > 0)
    ?? copies.find((c) => ready(c).length > 0)
  const image = preferred ? ready(preferred)[0] : undefined
  return image ? bookImageStorage().publicUrl(image.storage_key) : null
}

/**
 * PostgREST returns a to-one embed as a single object, but the inferred types
 * widen it to an array. Normalise instead of casting through `unknown`, so a
 * genuinely missing relation stays visible as null.
 */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function toListing(row: BookRow): BookListing {
  const copies = row.book_copies ?? []
  // RLS already limits this to reviews the caller may see, so a hidden one is
  // excluded from the average rather than needing a filter here.
  const ratings = (row.book_reviews ?? []).map((r) => r.rating)
  return {
    book: {
      id: row.id,
      title: row.title,
      author: row.author,
      isbn: row.isbn,
      publisher: row.publisher,
      language: row.language,
      description: row.description,
      publishedAt: row.published_at,
      coverColor: coverColorFor(row.id),
      coverUrl: coverUrlFrom(copies),
      createdAt: row.created_at,
    },
    availableCopies: copies.filter((c) => c.status === 'available').length,
    totalCopies: copies.length,
    avgRating:
      ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    reviewCount: ratings.length,
  }
}

export async function getRecentlyAdded(limit = 6): Promise<BookListing[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('books')
    .select(LIST_SELECT)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit * 3)
  if (error) throw error
  return ((data ?? []) as unknown as BookRow[])
    .map(toListing)
    .filter((l) => l.availableCopies > 0)
    .slice(0, limit)
}

export async function getPopular(limit = 6): Promise<BookListing[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('books').select(LIST_SELECT).limit(60)
  if (error) throw error
  // Placeholder heuristic until the ranking module lands: supply as a proxy
  // for demand. Deliberately simple, and isolated here so it can be replaced.
  return ((data ?? []) as unknown as BookRow[])
    .map(toListing)
    .sort((a, b) => b.availableCopies - a.availableCopies)
    .slice(0, limit)
}

export async function searchBooks(query: string): Promise<BookListing[]> {
  const q = query.trim()
  if (!q) return []
  const supabase = await createClient()
  const escaped = q.replace(/[%,()]/g, ' ')
  const { data, error } = await supabase
    .from('books')
    .select(LIST_SELECT)
    .or(`title.ilike.%${escaped}%,author.ilike.%${escaped}%,isbn.ilike.%${escaped}%`)
    .limit(40)
  if (error) throw error
  return ((data ?? []) as unknown as BookRow[]).map(toListing)
}

export type BookDetail = {
  listing: BookListing
  copies: {
    id: string
    condition: BookCondition
    conditionNote: string | null
    status: CopyStatus
    transferCount: number
    owner: { id: string; username: string; displayName: string; city: string | null } | null
    images: { id: string; url: string; sortOrder: number }[]
  }[]
}

export async function getBookDetail(id: string): Promise<BookDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('books')
    .select(LIST_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const { data: copyRows, error: copyError } = await supabase
    .from('book_copies')
    .select(
      `id, condition, condition_note, status, transfer_count,
       profiles!book_copies_owner_id_fkey ( id, username, display_name, city ),
       book_images ( id, storage_key, sort_order, status )`
    )
    .eq('book_id', id)
    .neq('status', 'inactive')
    .order('created_at', { ascending: true })
  if (copyError) throw copyError

  type CopyRow = {
    id: string
    condition: BookCondition
    condition_note: string | null
    status: CopyStatus
    transfer_count: number
    profiles:
      | { id: string; username: string; display_name: string; city: string | null }
      | { id: string; username: string; display_name: string; city: string | null }[]
      | null
    book_images: { id: string; storage_key: string; sort_order: number; status: string }[]
  }

  return {
    listing: toListing(data as unknown as BookRow),
    copies: ((copyRows ?? []) as unknown as CopyRow[]).map((c) => ({
      id: c.id,
      condition: c.condition,
      conditionNote: c.condition_note,
      status: c.status,
      transferCount: c.transfer_count,
      owner: (() => {
        const p = one(c.profiles)
        return p
          ? { id: p.id, username: p.username, displayName: p.display_name, city: p.city }
          : null
      })(),
      images: (c.book_images ?? [])
        .filter((i) => i.status === 'ready')
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => ({
          id: i.id,
          url: bookImageStorage().publicUrl(i.storage_key),
          sortOrder: i.sort_order,
        })),
    })),
  }
}

export type CopyDetail = {
  id: string
  condition: BookCondition
  conditionNote: string | null
  status: CopyStatus
  transferCount: number
  createdAt: string
  owner: { id: string; username: string; displayName: string; city: string | null } | null
  images: { id: string; url: string; sortOrder: number }[]
  book: { id: string; title: string; author: string | null; coverColor: string }
}

/** A single copy with its book + owner + images for the dedicated copy page. */
export async function getBookCopyDetail(copyId: string): Promise<CopyDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('book_copies')
    .select(
      `id, condition, condition_note, status, transfer_count, created_at,
       owner:profiles!book_copies_owner_id_fkey ( id, username, display_name, city ),
       book:books!book_copies_book_id_fkey ( id, title, author ),
       book_images ( id, storage_key, sort_order, status )`
    )
    .eq('id', copyId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  type Row = {
    id: string
    condition: BookCondition
    condition_note: string | null
    status: CopyStatus
    transfer_count: number
    created_at: string
    owner:
      | { id: string; username: string; display_name: string; city: string | null }
      | { id: string; username: string; display_name: string; city: string | null }[]
      | null
    book: { id: string; title: string; author: string | null } | { id: string; title: string; author: string | null }[] | null
    book_images: { id: string; storage_key: string; sort_order: number; status: string }[]
  }
  const r = data as unknown as Row
  const owner = one(r.owner)
  const book = one(r.book)
  if (!book) return null

  return {
    id: r.id,
    condition: r.condition,
    conditionNote: r.condition_note,
    status: r.status,
    transferCount: r.transfer_count,
    createdAt: r.created_at.slice(0, 10),
    owner: owner
      ? { id: owner.id, username: owner.username, displayName: owner.display_name, city: owner.city }
      : null,
    images: (r.book_images ?? [])
      .filter((i) => i.status === 'ready')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({
        id: i.id,
        url: bookImageStorage().publicUrl(i.storage_key),
        sortOrder: i.sort_order,
      })),
    book: { id: book.id, title: book.title, author: book.author, coverColor: coverColorFor(book.id) },
  }
}

export async function getMyCopies(userId: string) {  const supabase = await createClient()
  const { data, error } = await supabase
    .from('book_copies')
    .select(
      `id, condition, condition_note, status, transfer_count, created_at,
       books ( id, title, author )`
    )
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error

  type Row = {
    id: string
    condition: BookCondition
    condition_note: string | null
    status: CopyStatus
    transfer_count: number
    created_at: string
    books:
      | { id: string; title: string; author: string | null }
      | { id: string; title: string; author: string | null }[]
      | null
  }

  return ((data ?? []) as unknown as Row[]).flatMap((r) => {
    const book = one(r.books)
    if (!book) return []
    return [
      {
        copy: {
          id: r.id,
          condition: r.condition,
          conditionNote: r.condition_note,
          status: r.status,
          transferCount: r.transfer_count,
          createdAt: r.created_at.slice(0, 10),
        },
        book: {
          id: book.id,
          title: book.title,
          author: book.author,
          coverColor: coverColorFor(book.id),
        },
      },
    ]
  })
}
