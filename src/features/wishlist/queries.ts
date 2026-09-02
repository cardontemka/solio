import 'server-only'

import { createClient } from '@/lib/supabase/server'

/** A wishlist is private — RLS scopes every row to its owner. */

export type RequestView = {
  id: string
  title: string
  author: string | null
  isbn: string | null
  note: string | null
  status: 'open' | 'fulfilled' | 'cancelled'
  createdAt: string
  /** Set when the matcher found this book; the request stays open regardless. */
  matchedBookId: string | null
  matchedTitle: string | null
  /** True when the request points at a work that already exists here. */
  linkedBookId: string | null
}

type Row = {
  id: string
  title: string | null
  author: string | null
  isbn: string | null
  note: string | null
  status: 'open' | 'fulfilled' | 'cancelled'
  created_at: string
  book_id: string | null
  matched_book_id: string | null
  book: { id: string; title: string } | { id: string; title: string }[] | null
  matched: { id: string; title: string } | { id: string; title: string }[] | null
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export async function getMyRequests(): Promise<RequestView[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('book_requests')
    .select(
      `id, title, author, isbn, note, status, created_at, book_id, matched_book_id,
       book:books!book_requests_book_id_fkey ( id, title ),
       matched:books!book_requests_matched_book_id_fkey ( id, title )`
    )
    .order('created_at', { ascending: false })
  if (error) throw error

  return ((data ?? []) as unknown as Row[]).map((r) => {
    const linked = one(r.book)
    const matched = one(r.matched)
    return {
      id: r.id,
      // A wishlist entry against a known work may carry no free-text title.
      title: r.title ?? linked?.title ?? 'Нэргүй хүсэлт',
      author: r.author,
      isbn: r.isbn,
      note: r.note,
      status: r.status,
      createdAt: r.created_at.slice(0, 10),
      matchedBookId: r.matched_book_id,
      matchedTitle: matched?.title ?? null,
      linkedBookId: r.book_id,
    }
  })
}

/** Does the viewer already have an open request for this work? */
export async function hasOpenRequestFor(bookId: string): Promise<boolean> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('book_requests')
    .select('id', { count: 'exact', head: true })
    .eq('book_id', bookId)
    .eq('status', 'open')
  return (count ?? 0) > 0
}
