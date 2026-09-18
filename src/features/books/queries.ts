import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { avatarUrl } from '@/features/users/avatar'
import type {
  BookCategory,
  BookCondition,
  CopyStatus,
  ItemKind,
  StoredAt,
} from '@/types/domain'

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

// Re-exported so the many call sites that import it from here keep working;
// the implementation is client-safe and lives on its own (coverColor.ts).
import { coverColorFor } from './coverColor'

export { coverColorFor }

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
  /**
   * A venue rather than a reader — which changes what the listing is. A venue
   * owns a book because somebody donated it, and it goes out again for a credit,
   * never for a swap; the database refuses a swap that involves one
   * (POINT_ITEMS_ARE_BY_CREDIT), so the card has to say so before anybody tries.
   */
  isStoragePoint: boolean
}

export type Listing = {
  /** The listing's own id, and what every URL uses. */
  copyId: string
  /**
   * The code printed on the object itself — eight characters, permanent, and
   * the only way to recognise a physical book that is not in your hands.
   */
  publicCode: string
  /** The catalogue row behind it — kept for search indexing and history. */
  bookId: string
  title: string
  author: string | null
  isbn: string | null
  publisher: string | null
  language: string | null
  description: string | null
  publishedAt: string | null
  kind: ItemKind
  categories: BookCategory[]
  /**
   * The fields that belong to this kind alone — page count for a book, rpm and
   * disc size for a record. Held in one jsonb column so a new kind adds no
   * columns; ATTRIBUTES_FOR says how to label and order them.
   */
  attributes: Record<string, string | number>
  weightG: number | null
  sizeNote: string | null
  condition: BookCondition
  conditionNote: string | null
  status: CopyStatus
  transferCount: number
  createdAt: string
  coverColor: string
  images: { id: string; url: string; thumbUrl: string; sortOrder: number }[]
  owner: ListingOwner | null
  /**
   * Where the thing physically is, when that is not with its owner — and only
   * for a reader entitled to know: its owner, the venue holding it, or the
   * counterparty of the swap it is waiting for. Null everywhere else, including
   * for everybody browsing the feed.
   */
  storedAt: StoredAt | null
}

// book_copies has two foreign keys to profiles (owner, custodian), so the embed
// has to name the constraint or PostgREST refuses it as ambiguous.
const LISTING_SELECT = `
  id, public_code, condition, condition_note, status, transfer_count, created_at,
  books!inner ( id, title, author, isbn, publisher, language, description, published_at,
                categories, weight_g, size_note, kind, attributes ),
  owner:profiles!book_copies_owner_id_fkey ( id, username, display_name, city, avatar_key, account_type ),
  book_images ( id, storage_key, thumb_key, sort_order, status )
`

type ListingOwnerRow = {
  id: string
  username: string
  display_name: string
  city: string | null
  avatar_key: string | null
  account_type: string | null
}

type ListingRow = {
  id: string
  public_code: string
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
        categories: BookCategory[] | null
        weight_g: number | null
        size_note: string | null
        kind: ItemKind
        attributes: Record<string, string | number> | null
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
        categories: BookCategory[] | null
        weight_g: number | null
        size_note: string | null
        kind: ItemKind
        attributes: Record<string, string | number> | null
      }[]
    | null
  owner: ListingOwnerRow | ListingOwnerRow[] | null
  book_images: {
    id: string
    storage_key: string
    thumb_key: string | null
    sort_order: number
    status: string
  }[]
}

function toListing(row: ListingRow): Listing | null {
  const book = one(row.books)
  if (!book) return null
  const owner = one(row.owner)
  const storage = bookImageStorage()
  return {
    copyId: row.id,
    publicCode: row.public_code,
    bookId: book.id,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    publisher: book.publisher,
    language: book.language,
    description: book.description,
    publishedAt: book.published_at,
    kind: book.kind ?? 'book',
    categories: book.categories ?? [],
    attributes: book.attributes ?? {},
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
      .map((i) => ({
        id: i.id,
        url: storage.publicUrl(i.storage_key),
        // Photos uploaded before thumbnails existed have none; the full image
        // stands in, which costs bandwidth but never shows a hole.
        thumbUrl: storage.publicUrl(i.thumb_key ?? i.storage_key),
        sortOrder: i.sort_order,
      })),
    owner: owner
      ? {
          id: owner.id,
          username: owner.username,
          displayName: owner.display_name,
          city: owner.city,
          avatarUrl: avatarUrl(owner.avatar_key),
          isStoragePoint: owner.account_type === 'storage_point',
        }
      : null,
    // Filled in by withStorage() for the few readers entitled to know; the
    // columns behind it are not selectable at all any more.
    storedAt: null,
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
    kind,
    statusIn,
  }: {
    limit?: number
    offset?: number
    category?: string
    kind?: string
    /** Which copy states to include. Omitted means all of them. */
    statusIn?: CopyStatus[]
  } = {}
): Promise<Listing[]> {
  const supabase = await createClient()
  let query = supabase
    .from('book_copies')
    .select(LISTING_SELECT)
    // listed_at, not created_at: the feed means "what has just become something
    // you could take", and for a book donated to a venue this morning the
    // registration date is months old. The database maintains it — see
    // private.book_copies_guard.
    .order('listed_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)
  // Containment, not equality: a book carries several headings now, and the
  // filter asks whether the chosen one is among them. Filtering on the embedded
  // table narrows the join, so a listing whose book does not match drops out
  // rather than coming back with books = null.
  if (category) query = query.contains('books.categories', [category])
  if (kind) query = query.eq('books.kind', kind)
  if (statusIn?.length) query = query.in('status', statusIn)
  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as unknown as ListingRow[]).flatMap((r) => toListing(r) ?? [])
}

/**
 * Title, author and ISBN live on `books`, so the filter has to run against the
 * embedded resource; `books!inner` makes that a join rather than a left join,
 * so a non-matching listing drops out instead of coming back with books = null.
 */
export async function searchListings(
  query: string,
  category?: string,
  { limit = 24, offset = 0, kind }: { limit?: number; offset?: number; kind?: string } = {}
): Promise<Listing[]> {
  const q = query.trim()
  if (!q) return []
  const supabase = await createClient()
  const escaped = q.replace(/[%,()]/g, ' ')
  let builder = supabase
    .from('book_copies')
    .select(LISTING_SELECT)
  if (category) builder = builder.contains('books.categories', [category])
  if (kind) builder = builder.eq('books.kind', kind)
  const { data, error } = await builder
    .or(
      `title.ilike.%${escaped}%,author.ilike.%${escaped}%,isbn.ilike.%${escaped}%,` +
        `publisher.ilike.%${escaped}%`,
      { referencedTable: 'books' }
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)
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
    // count(), not the rows: the embed used to pull every listing each matching
    // person owns just to count the available ones — 250 rows for one line of
    // text under their name.
    .select(
      'username, display_name, city, ' +
        'book_copies!book_copies_owner_id_fkey ( count )'
    )
    .eq('account_status', 'active')
    .or(`username.ilike.%${escaped}%,display_name.ilike.%${escaped}%`)
    .limit(12)
  if (error) throw error
  type Row = {
    username: string
    display_name: string
    city: string | null
    book_copies: { count: number }[]
  }
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    username: r.username,
    displayName: r.display_name,
    city: r.city,
    listingCount: r.book_copies?.[0]?.count ?? 0,
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
  const listing = toListing(data as unknown as ListingRow)
  if (!listing) return null
  return (await withStorage([listing]))[0] ?? listing
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

/**
 * The viewer's own listings, one page at a time.
 *
 * Unbounded before, which was fine while everyone had five books and became a
 * megabyte of HTML for anybody who had two hundred. `fetch` is one more than the
 * page shows — the extra row is what answers "is there another page?".
 */
export async function getMyCopies(
  userId: string,
  { limit = 24, offset = 0 }: { limit?: number; offset?: number } = {}
) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('book_copies')
    .select(LISTING_SELECT)
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw error
  // The owner is always entitled to know where their own things are.
  return withStorage(((data ?? []) as unknown as ListingRow[]).flatMap((r) => toListing(r) ?? []))
}

/**
 * Fills in `storedAt` on listings the caller may see it for.
 *
 * One round trip for a whole page of rows, and the database decides who is
 * entitled — the app never has to remember the rule.
 */
export async function withStorage(listings: Listing[]): Promise<Listing[]> {
  if (listings.length === 0) return listings
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('storage_for_copies', {
    p_copy_ids: listings.map((l) => l.copyId),
  })
  // A signed-out reader is entitled to none of it; that is not worth an error.
  if (error || !data) return listings

  type Row = {
    copy_id: string
    point_id: string
    username: string
    name: string
    kind: string
    city: string
    district: string
    address: string
    stored_since: string
  }
  const byCopy = new Map<string, StoredAt>()
  for (const r of data as Row[]) {
    byCopy.set(r.copy_id, {
      id: r.point_id,
      username: r.username,
      name: r.name,
      kind: r.kind as StoredAt['kind'],
      city: r.city,
      district: r.district,
      address: r.address,
      since: r.stored_since.slice(0, 10),
    })
  }
  if (byCopy.size === 0) return listings
  return listings.map((l) => ({ ...l, storedAt: byCopy.get(l.copyId) ?? null }))
}

/** Listings by id, in the order given. Used where a function knows the ids. */
export async function getListingsByIds(ids: string[]): Promise<Listing[]> {
  if (ids.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase.from('book_copies').select(LISTING_SELECT).in('id', ids)
  if (error) throw error
  const rows = ((data ?? []) as unknown as ListingRow[]).flatMap((r) => toListing(r) ?? [])
  const order = new Map(ids.map((id, i) => [id, i]))
  return rows.sort((a, b) => (order.get(a.copyId) ?? 0) - (order.get(b.copyId) ?? 0))
}

export type PublicProfile = {
  id: string
  username: string
  displayName: string
  bio: string | null
  city: string | null
  avatarUrl: string | null
  joinedAt: string
  /** A person, or a venue that holds other people's books. */
  accountType: 'person' | 'storage_point'
  /** One page of listings. */
  listings: Listing[]
  /**
   * How many of their listings are open to swap, across every page. Counted in
   * the database: with paging in place, counting the rows on screen would report
   * "24 ном нээлттэй" to somebody who has three hundred.
   */
  availableCount: number
}

/**
 * Someone else's profile as the public sees it: who they are and what they have
 * listed. Never their email — that lives only in auth.users, which no
 * client-side query can reach.
 *
 * A suspended account resolves to null so a moderated profile stops being a
 * browsable page.
 */
export async function getPublicProfile(
  username: string,
  { limit = 24, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<PublicProfile | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, username, display_name, bio, city, avatar_key, created_at, account_status, account_type'
    )
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
    account_type: string
  }
  if (profile.account_status !== 'active') return null

  const { count: availableCount } = await supabase
    .from('book_copies')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', profile.id)
    .eq('status', 'available')

  // Paged for the same reason as /my-books: a profile with 250 listings served
  // a megabyte of HTML, measured. The extra row tells the page there is more.
  const { data: rows, error: copiesError } = await supabase
    .from('book_copies')
    .select(LISTING_SELECT)
    .eq('owner_id', profile.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)
  if (copiesError) throw copiesError

  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    bio: profile.bio,
    city: profile.city,
    avatarUrl: avatarUrl(profile.avatar_key),
    joinedAt: profile.created_at.slice(0, 10),
    accountType: profile.account_type === 'storage_point' ? 'storage_point' : 'person',
    listings: ((rows ?? []) as unknown as ListingRow[]).flatMap((r) => toListing(r) ?? []),
    availableCount: availableCount ?? 0,
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
export async function getSwapHistory(
  userId: string,
  { limit = 10, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<SwapHistoryEntry[]> {
  const supabase = await createClient()
  // The RPC returns a set, so PostgREST's range applies to it like a table.
  const { data, error } = await supabase
    .rpc('get_swap_history', { p_user: userId })
    .range(offset, offset + limit - 1)
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
       book_images ( storage_key, thumb_key, sort_order, status )`
    )
    .or(`title.ilike.%${escaped}%,author.ilike.%${escaped}%`, { referencedTable: 'books' })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  type Row = {
    id: string
    books: { title: string; author: string | null } | { title: string; author: string | null }[] | null
    owner: { display_name: string } | { display_name: string }[] | null
    book_images: {
      storage_key: string
      thumb_key: string | null
      sort_order: number
      status: string
    }[]
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
        imageUrl: cover ? storage.publicUrl(cover.thumb_key ?? cover.storage_key) : null,
        ownerName: one(r.owner)?.display_name ?? null,
      },
    ]
  })
}

/**
 * A catalogue row somebody has already described, offered while a title is
 * being typed into the add-book form.
 *
 * Not the same thing as a search suggestion: that one points at one person's
 * listing, this one carries the description a new listing can adopt. Titles only
 * — the reader is answering "is this the same book?", and matching their
 * half-typed title against a stranger's description turns that into a guess.
 */
export type CatalogueMatch = {
  bookId: string
  kind: ItemKind
  title: string
  author: string | null
  isbn: string | null
  publisher: string | null
  language: string | null
  description: string | null
  publishedYear: number | null
  categories: BookCategory[]
  weightG: number | null
  sizeNote: string | null
  attributes: Record<string, string | number>
  /** How many people already list this exact row. */
  copyCount: number
  coverUrl: string | null
}

export async function suggestCatalogue(
  query: string,
  kind: ItemKind = 'book',
  limit = 6
): Promise<CatalogueMatch[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('suggest_catalogue', {
    p_query: q,
    p_limit: limit,
    p_kind: kind,
  })
  if (error) throw error

  type Row = {
    id: string
    title: string
    author: string | null
    isbn: string | null
    publisher: string | null
    language: string | null
    description: string | null
    published_at: string | null
    categories: string[] | null
    weight_g: number | null
    size_note: string | null
    kind: ItemKind
    attributes: Record<string, string | number> | null
    copy_count: number | string
    cover_key: string | null
  }
  const storage = bookImageStorage()
  return ((data ?? []) as Row[]).map((r) => ({
    bookId: r.id,
    kind: r.kind ?? 'book',
    title: r.title,
    author: r.author,
    isbn: r.isbn,
    publisher: r.publisher,
    language: r.language,
    description: r.description,
    // The form asks for a year; the column stores the first of January.
    publishedYear: r.published_at ? Number(r.published_at.slice(0, 4)) : null,
    categories: (r.categories ?? []) as BookCategory[],
    weightG: r.weight_g,
    sizeNote: r.size_note,
    attributes: r.attributes ?? {},
    copyCount: Number(r.copy_count ?? 0),
    coverUrl: r.cover_key ? storage.publicUrl(r.cover_key) : null,
  }))
}

export type SitemapRow = { path: string; updatedAt?: string }

/**
 * Everything a crawler should know about, as paths.
 *
 * Runs as the anonymous reader, so RLS decides what is in it: a hidden listing
 * or a suspended profile simply does not come back, and the sitemap cannot leak
 * something the site would not serve anyway. Capped rather than paged — at
 * 50,000 URLs a sitemap has to be split, and this site is a long way from that;
 * when it gets there, generateSitemaps is the answer.
 */
export async function getSitemapRows(): Promise<SitemapRow[]> {
  const supabase = await createClient()

  const [listings, profiles, requests] = await Promise.all([
    supabase
      .from('book_copies')
      .select('id, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20000),
    supabase
      .from('profiles')
      .select('username, updated_at')
      .eq('account_status', 'active')
      .order('updated_at', { ascending: false })
      .limit(5000),
    supabase
      .from('book_requests')
      .select('id, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(5000),
  ])

  const rows: SitemapRow[] = []
  for (const r of (listings.data ?? []) as { id: string; updated_at: string }[]) {
    rows.push({ path: `/books/${r.id}`, updatedAt: r.updated_at })
  }
  for (const r of (profiles.data ?? []) as { username: string; updated_at: string }[]) {
    rows.push({ path: `/u/${r.username}`, updatedAt: r.updated_at })
  }
  for (const r of (requests.data ?? []) as { id: string; created_at: string }[]) {
    rows.push({ path: `/requests/${r.id}`, updatedAt: r.created_at })
  }
  return rows
}

export type TrailStep = {
  eventType: 'initial_registration' | 'swap_transfer' | 'claim_transfer' | 'admin_correction'
  occurredAt: string
  fromName: string | null
  fromUsername: string | null
  toName: string
  toUsername: string
}

/**
 * Everywhere a copy has been, oldest first.
 *
 * The ledger has recorded this since the first migration and nothing ever
 * showed it. On a site whose premise is that objects outlive their owners, the
 * list of hands a book has passed through is the most interesting thing about
 * it — and it is already public: every name in it is a public profile, and each
 * transfer was visible as a changed owner at the time.
 */
export async function getCopyTrail(copyId: string): Promise<TrailStep[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('copy_trail', { p_copy_id: copyId })
  if (error) return []
  type Row = {
    event_type: TrailStep['eventType']
    occurred_at: string
    from_name: string | null
    from_user: string | null
    to_name: string
    to_user: string
  }
  return ((data ?? []) as Row[]).map((r) => ({
    eventType: r.event_type,
    occurredAt: r.occurred_at.slice(0, 10),
    fromName: r.from_name,
    fromUsername: r.from_user,
    toName: r.to_name,
    toUsername: r.to_user,
  }))
}
