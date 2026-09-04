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
    owner_id: string
    books: { id: string; title: string; author: string | null } | { id: string; title: string; author: string | null }[] | null
    book_images: { storage_key: string; sort_order: number; status: string }[]
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
  /** Whether the viewer is the one who already confirmed handover. */
  iConfirmed: boolean
  awaitingMe: boolean
  offered: SwapItemView[]
  requested: SwapItemView[]
}

/** First ready photo of a copy, in sort order — the cover the cards show. */
function coverOf(
  images: { storage_key: string; sort_order: number; status: string }[] | null | undefined
): string | null {
  const ready = (images ?? [])
    .filter((i) => i.status === 'ready')
    .sort((a, b) => a.sort_order - b.sort_order)[0]
  return ready ? bookImageStorage().publicUrl(ready.storage_key) : null
}

export async function getMySwaps(userId: string): Promise<SwapView[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('swaps')
    .select(
      `id, requester_id, responder_id, status, confirmed_by, message, created_at,
       requester:profiles!swaps_requester_id_fkey ( id, username, display_name ),
       responder:profiles!swaps_responder_id_fkey ( id, username, display_name ),
       swap_items ( side, book_copies ( id, condition, status, owner_id,
                                        books ( id, title, author ),
                                        book_images ( storage_key, sort_order, status ) ) )`
    )
    .order('created_at', { ascending: false })
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
      iConfirmed,
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

/** The viewer's own available copies — what they can put on the table. */
export async function getOfferableCopies(userId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('book_copies')
    .select(`id, condition, books ( id, title, author )`)
    .eq('owner_id', userId)
    .eq('status', 'available')
    .order('created_at', { ascending: false })
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
