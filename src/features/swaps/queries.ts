import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { coverColorFor } from '@/features/books/queries'
import type { SwapStatus } from '@/types/domain'

/**
 * Read side of the swap feature. RLS restricts `swaps` to participants, so
 * these queries need no "where I am involved" clause of their own.
 */

type ItemRow = {
  side: 'offered' | 'requested'
  book_copies: {
    id: string
    condition: string
    status: string
    moderation_status: string
    owner_id: string
    books: { id: string; title: string; author: string | null } | { id: string; title: string; author: string | null }[] | null
    book_images: { storage_key: string; thumb_key: string | null; sort_order: number; status: string }[]
  } | null
}

type SwapRow = {
  id: string
  requester_id: string
  responder_id: string
  status: SwapStatus
  confirmed_by: string | null
  message: string | null
  created_at: string
  requester: { id: string; username: string; display_name: string } | { id: string; username: string; display_name: string }[] | null
  responder: { id: string; username: string; display_name: string } | { id: string; username: string; display_name: string }[] | null
  swap_items: ItemRow[]
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export type SwapItemView = {
  copyId: string
  bookId: string
  title: string
  author: string | null
  coverColor: string
  imageUrl: string | null
}

export type SwapView = {
  id: string
  status: SwapStatus
  message: string | null
  createdAt: string
  direction: 'incoming' | 'outgoing'
  counterpartyName: string
  counterpartyUsername: string | null
  /** Whether the viewer is the one who already confirmed handover. */
  iConfirmed: boolean
  awaitingMe: boolean
  /**
   * True when this swap can no longer be carried out — a book in it has changed
   * hands, been handed over elsewhere, or been taken down. The database is the
   * authority (private.swap_is_fulfillable); this is the same question asked
   * from the rows already on hand, so the page can offer a way out instead of
   * a button that will be refused.
   */
  blocked: boolean
  offered: SwapItemView[]
  requested: SwapItemView[]
}

/** First ready photo of a copy, in sort order — the cover the cards show. */
function coverOf(
  images:
    | { storage_key: string; thumb_key: string | null; sort_order: number; status: string }[]
    | null
    | undefined
): string | null {
  const ready = (images ?? [])
    .filter((i) => i.status === 'ready')
    .sort((a, b) => a.sort_order - b.sort_order)[0]
  // These are all small thumbnails on cards and rows, so the grid-sized copy
  // is what they want; the full photo stands in for older uploads.
  return ready ? bookImageStorage().publicUrl(ready.thumb_key ?? ready.storage_key) : null
}

/**
 * The viewer's own swaps.
 *
 * Filtered by hand rather than left to RLS. A moderator's policy lets them read
 * every swap on the site, so without this the page showed strangers' trades
 * with "you" written on both sides — direction and counterparty are computed
 * against the viewer, so somebody else's swap read as theirs. RLS is the
 * security boundary; deciding *whose* swaps a page is about is this query's
 * job.
 */
export async function getMySwaps(
  userId: string,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<SwapView[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('swaps')
    .select(
      `id, requester_id, responder_id, status, confirmed_by, message, created_at,
       requester:profiles!swaps_requester_id_fkey ( id, username, display_name ),
       responder:profiles!swaps_responder_id_fkey ( id, username, display_name ),
       swap_items ( side, book_copies ( id, condition, status, moderation_status, owner_id,
                                        books ( id, title, author ),
                                        book_images ( storage_key, thumb_key, sort_order, status ) ) )`
    )
    .or(`requester_id.eq.${userId},responder_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw error

  const toItems = (rows: ItemRow[], side: 'offered' | 'requested'): SwapItemView[] =>
    rows
      .filter((r) => r.side === side && r.book_copies)
      .flatMap((r) => {
        const book = one(r.book_copies!.books)
        if (!book) return []
        return [
          {
            copyId: r.book_copies!.id,
            bookId: book.id,
            title: book.title,
            author: book.author,
            coverColor: coverColorFor(book.id),
            imageUrl: coverOf(r.book_copies!.book_images),
          },
        ]
      })

  return ((data ?? []) as unknown as SwapRow[]).map((s) => {
    const outgoing = s.requester_id === userId
    const other = one(outgoing ? s.responder : s.requester)
    const iConfirmed = s.confirmed_by === userId
    return {
      id: s.id,
      status: s.status,
      message: s.message,
      createdAt: s.created_at.slice(0, 10),
      direction: outgoing ? 'outgoing' : 'incoming',
      counterpartyName: other?.display_name ?? 'Тодорхойгүй',
      counterpartyUsername: other?.username ?? null,
      iConfirmed,
      blocked: (s.swap_items ?? []).some((item) => {
        const copy = item.book_copies
        // Gone, or hidden from this reader by moderation — either way there is
        // nothing left to hand over.
        if (!copy) return true
        if (copy.moderation_status === 'removed') return true
        if (copy.status === 'swapped') return true
        const shouldOwn = item.side === 'offered' ? s.requester_id : s.responder_id
        return copy.owner_id !== shouldOwn
      }),
      // Whose move is it? Drives which buttons the page offers.
      awaitingMe:
        (s.status === 'REQUESTED' && !outgoing) ||
        s.status === 'ACCEPTED' ||
        (s.status === 'CONFIRMED' && !iConfirmed),
      offered: toItems(s.swap_items ?? [], 'offered'),
      requested: toItems(s.swap_items ?? [], 'requested'),
    }
  })
}

/**
 * The viewer's own available copies — what they can put on the table.
 *
 * Capped: this fills a picker, and a picker with two hundred entries is not a
 * picker. Newest first, because a book someone just added is the one they are
 * most likely to be offering.
 */
export async function getOfferableCopies(userId: string, limit = 60) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('book_copies')
    .select(`id, condition, books ( id, title, author )`)
    .eq('owner_id', userId)
    .eq('status', 'available')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  type Row = {
    id: string
    condition: string
    books: { id: string; title: string; author: string | null } | { id: string; title: string; author: string | null }[] | null
  }
  return ((data ?? []) as unknown as Row[]).flatMap((r) => {
    const book = one(r.books)
    if (!book) return []
    return [{ copyId: r.id, title: book.title, author: book.author }]
  })
}

export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  return count ?? 0
}
