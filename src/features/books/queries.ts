import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { avatarUrl } from '@/features/users/avatar'
import type { BookCategory, BookCondition, CopyStatus } from '@/types/domain'

/**
 * Read side of the books feature.
 *
 * A row in `book_copies` is what a reader sees and what they click: one person
 * offering one physical book. `books` still exists — ownership history has to
 * point at something stable, and finding that two listings are the same work is
 * a later feature — but nothing user-facing addresses it. There is no page for
 * "the book" and no notion of a book having several copies.
 *
 * Every query runs as the caller, so RLS — not a WHERE clause here — is what
 * keeps hidden rows hidden.
 */

/**
 * Deterministic cover colour so a listing looks the same everywhere.
 *
 * FNV-1a rather than the usual `hash*31 + c`: UUIDs share a fixed layout and
 * alphabet, and the weak hash clustered several books onto the same swatch.
 */
export function coverColorFor(id: string): string {
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

/**
 * PostgREST returns a to-one embed as a single object, but the inferred types
 * widen it to an array. Normalise instead of casting through `unknown`, so a
 * genuinely missing relation stays visible as null.
 */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export type ListingOwner = {
  id: string
  username: string
  displayName: string
  city: string | null
  avatarUrl: string | null
}

export type Listing = {
  /** The listing's own id, and what every URL uses. */
  copyId: string
  /** The catalogue row behind it — kept for search indexing and history. */
  bookId: string
  title: string
  author: string | null
  isbn: string | null
  publisher: string | null
  language: string | null
  description: string | null
  publishedAt: string | null
  category: BookCategory | null
  pageCount: number | null
  weightG: number | null
  sizeNote: string | null
  condition: BookCondition
  conditionNote: string | null
  status: CopyStatus
  transferCount: number
  createdAt: string
  coverColor: string
  images: { id: string; url: string; sortOrder: number }[]
  owner: ListingOwner | null
}

// book_copies has two foreign keys to profiles (owner, custodian), so the embed
// has to name the constraint or PostgREST refuses it as ambiguous.
const LISTING_SELECT = `
  id, condition, condition_note, status, transfer_count, created_at,
  books!inner ( id, title, author, isbn, publisher, language, description, published_at,
                category, page_count, weight_g, size_note ),
  owner:profiles!book_copies_owner_id_fkey ( id, username, display_name, city, avatar_key ),
  book_images ( id, storage_key, sort_order, status )
`

type ListingRow = {
  id: string
  condition: BookCondition
  condition_note: string | null
  status: CopyStatus
  transfer_count: number
  created_at: string
  books:
    | {
        id: string
        title: string
        author: string | null
        isbn: string | null
        publisher: string | null
        language: string | null
        description: string | null
        published_at: string | null
        category: BookCategory | null
        page_count: number | null
        weight_g: number | null
        size_note: string | null
      }
    | {
        id: string
        title: string
        author: string | null
        isbn: string | null
        publisher: string | null
        language: string | null
        description: string | null
        published_at: string | null
        category: BookCategory | null
        page_count: number | null
        weight_g: number | null
        size_note: string | null
      }[]
    | null
  owner:
    | { id: string; username: string; display_name: string; city: string | null; avatar_key: string | null }
    | { id: string; username: string; display_name: string; city: string | null; avatar_key: string | null }[]
    | null
  book_images: { id: string; storage_key: string; sort_order: number; status: string }[]
}

function toListing(row: ListingRow): Listing | null {
  const book = one(row.books)
  if (!book) return null
  const owner = one(row.owner)
  const storage = bookImageStorage()
  return {
    copyId: row.id,
    bookId: book.id,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    publisher: book.publisher,
    language: book.language,
    description: book.description,
    publishedAt: book.published_at,
    category: book.category,
    pageCount: book.page_count,
    weightG: book.weight_g,
    sizeNote: book.size_note,
    condition: row.condition,
    conditionNote: row.condition_note,
    status: row.status,
    transferCount: row.transfer_count,
    createdAt: row.created_at.slice(0, 10),
    coverColor: coverColorFor(row.id),
    images: (row.book_images ?? [])
      .filter((i) => i.status === 'ready')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ id: i.id, url: storage.publicUrl(i.storage_key), sortOrder: i.sort_order })),
    owner: owner
      ? {
          id: owner.id,
          username: owner.username,
          displayName: owner.display_name,
          city: owner.city,
          avatarUrl: avatarUrl(owner.avatar_key),
        }
      : null,
  }
}

/**
 * Everything the site holds, newest first — including copies that are already
 * swapped or that their owner has taken down. Hiding those made the catalogue
 * look emptier than it is and lost the useful signal that a title exists here
 * at all; the card says which state each one is in, and the owner can put a
 * finished one back up.
 *
 * Moderated rows never appear: RLS drops them before this query sees them.
 */
export async function getListings(
  {
    limit = 12,
    offset = 0,
    category,
  }: { limit?: number; offset?: number; category?: string } = {}
): Promise<Listing[]> {
  const supabase = await createClient()
  let query = supabase
    .from('book_copies')
    .select(LISTING_SELECT)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)
  // Filtering on the embedded table narrows the join, so a listing whose book
  // is in another category drops out rather than coming back empty.
  if (category) query = query.eq('books.category', category)
  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as unknown as ListingRow[]).flatMap((r) => toListing(r) ?? [])
}

/**
 * Title, author and ISBN live on `books`, so the filter has to run against the
 * embedded resource; `books!inner` makes that a join rather than a left join,
 * so a non-matching listing drops out instead of coming back with books = null.
 */
export async function searchListings(query: string, category?: string): Promise<Listing[]> {
  const q = query.trim()
  if (!q) return []
  const supabase = await createClient()
  const escaped = q.replace(/[%,()]/g, ' ')
  let builder = supabase
    .from('book_copies')
    .select(LISTING_SELECT)
  if (category) builder = builder.eq('books.category', category)
  const { data, error } = await builder
    .or(
      `title.ilike.%${escaped}%,author.ilike.%${escaped}%,isbn.ilike.%${escaped}%,` +
        `publisher.ilike.%${escaped}%`,
      { referencedTable: 'books' }
    )
    .order('created_at', { ascending: false })
    .limit(48)
  if (error) throw error
  return ((data ?? []) as unknown as ListingRow[]).flatMap((r) => toListing(r) ?? [])
}

export type ProfileResult = {
  username: string
  displayName: string
  city: string | null
  listingCount: number
}

/** People matching the same search box. */
export async function searchProfiles(query: string): Promise<ProfileResult[]> {
  const q = query.trim()
  if (!q) return []
  const supabase = await createClient()
  const escaped = q.replace(/[%,()]/g, ' ')
  const { data, error } = await supabase
    .from('profiles')
    .select('username, display_name, city, book_copies!book_copies_owner_id_fkey ( status )')
    .eq('account_status', 'active')
    .or(`username.ilike.%${escaped}%,display_name.ilike.%${escaped}%`)
    .limit(12)
  if (error) throw error
  type Row = {
    username: string
    display_name: string
    city: string | null
    book_copies: { status: string }[]
  }
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    username: r.username,
    displayName: r.display_name,
    city: r.city,
    listingCount: (r.book_copies ?? []).filter((c) => c.status === 'available').length,
  }))
}

/** One listing, by its own id. */
export async function getListing(copyId: string): Promise<Listing | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('book_copies')
    .select(LISTING_SELECT)
    .eq('id', copyId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toListing(data as unknown as ListingRow)
}

/**
 * Links minted before listings had their own URLs — and the notification rows
 * the database still writes with entity_type 'book' — carry a books id. Resolve
 * it to a listing so those keep working instead of 404ing.
 */
export async function findListingIdForBook(bookId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('book_copies')
    .select('id, status')
    .eq('book_id', bookId)
    .order('created_at', { ascending: true })
  const rows = (data ?? []) as { id: string; status: string }[]
  return (rows.find((r) => r.status === 'available') ?? rows[0])?.id ?? null
}

export async function getMyCopies(userId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('book_copies')
    .select(LISTING_SELECT)
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as ListingRow[]).flatMap((r) => toListing(r) ?? [])
}

export type PublicProfile = {
  id: string
  username: string
  displayName: string
  bio: string | null
  city: string | null
  avatarUrl: string | null
  joinedAt: string
  listings: Listing[]
}

/**
 * Someone else's profile as the public sees it: who they are and what they have
 * listed. Never their email — that lives only in auth.users, which no
 * client-side query can reach.
 *
 * A suspended account resolves to null so a moderated profile stops being a
 * browsable page.
 */
export async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, bio, city, avatar_key, created_at, account_status')
    .ilike('username', username)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const profile = data as {
    id: string
    username: string
    display_name: string
    bio: string | null
    city: string | null
    avatar_key: string | null
    created_at: string
    account_status: string
  }
  if (profile.account_status !== 'active') return null

  const { data: rows, error: copiesError } = await supabase
    .from('book_copies')
    .select(LISTING_SELECT)
    .eq('owner_id', profile.id)
    .order('created_at', { ascending: false })
  if (copiesError) throw copiesError

  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    bio: profile.bio,
    city: profile.city,
    avatarUrl: avatarUrl(profile.avatar_key),
    joinedAt: profile.created_at.slice(0, 10),
    listings: ((rows ?? []) as unknown as ListingRow[]).flatMap((r) => toListing(r) ?? []),
  }
}

export type SwapHistoryEntry = {
  swapId: string
  completedAt: string
  counterpartyName: string
  counterpartyUsername: string
  gave: string[]
  received: string[]
}

/**
 * Somebody's finished swaps, as the public sees them.
 *
 * `swaps` itself stays participant-only; get_swap_history is a SECURITY DEFINER
 * view over the completed ones. Nothing here is new information — both
 * listings were public and the ownership transfer is visible on the copies —
 * but the join is not one an anonymous reader could make.
 */
export async function getSwapHistory(userId: string): Promise<SwapHistoryEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_swap_history', { p_user: userId })
  if (error) throw error
  type Row = {
    swap_id: string
    completed_at: string
    counterparty_name: string
    counterparty_user: string
    gave_titles: string[] | null
    received_titles: string[] | null
  }
  return ((data ?? []) as Row[]).map((r) => ({
    swapId: r.swap_id,
    completedAt: r.completed_at.slice(0, 10),
    counterpartyName: r.counterparty_name,
    counterpartyUsername: r.counterparty_user,
    gave: r.gave_titles ?? [],
    received: r.received_titles ?? [],
  }))
}

export type Suggestion = {
  copyId: string
  title: string
  author: string | null
  imageUrl: string | null
  ownerName: string | null
}

/**
 * Type-ahead matches for the search box.
 *
 * Deliberately the same source as the results page: a suggestion that leads
 * nowhere is worse than none, so this only ever offers listings that exist and
 * that the caller may open. Kept to the few fields a row shows, because it runs
 * on every few keystrokes.
 */
export async function suggestListings(query: string, limit = 7): Promise<Suggestion[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const supabase = await createClient()
  const escaped = q.replace(/[%,()]/g, ' ')
  const { data, error } = await supabase
    .from('book_copies')
    .select(
      `id, status,
       books!inner ( title, author ),
       owner:profiles!book_copies_owner_id_fkey ( display_name ),
       book_images ( storage_key, sort_order, status )`
    )
    .or(`title.ilike.%${escaped}%,author.ilike.%${escaped}%`, { referencedTable: 'books' })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  type Row = {
    id: string
    books: { title: string; author: string | null } | { title: string; author: string | null }[] | null
    owner: { display_name: string } | { display_name: string }[] | null
    book_images: { storage_key: string; sort_order: number; status: string }[]
  }
  const storage = bookImageStorage()
  return ((data ?? []) as unknown as Row[]).flatMap((r) => {
    const book = one(r.books)
    if (!book) return []
    const cover = (r.book_images ?? [])
      .filter((i) => i.status === 'ready')
      .sort((a, b) => a.sort_order - b.sort_order)[0]
    return [
      {
        copyId: r.id,
        title: book.title,
        author: book.author,
        imageUrl: cover ? storage.publicUrl(cover.storage_key) : null,
        ownerName: one(r.owner)?.display_name ?? null,
      },
    ]
  })
}
