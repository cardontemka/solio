import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * A request is a post: somebody says which book they are looking for, and other
 * people answer underneath. There is no automatic matching — that was the old
 * wishlist, and it never told anyone anything useful (ADR-032).
 *
 * Posts are world-readable, so these queries add no owner filter; RLS hides a
 * cancelled post from everyone but its author and staff.
 */
export type RequestView = {
  id: string
  title: string
  author: string | null
  isbn: string | null
  note: string | null
  status: 'open' | 'fulfilled' | 'cancelled'
  createdAt: string
  commentCount: number
  isMine: boolean
  authorName: string
  authorUsername: string
}

type Row = {
  id: string
  user_id: string
  title: string
  author: string | null
  isbn: string | null
  note: string | null
  status: 'open' | 'fulfilled' | 'cancelled'
  created_at: string
  poster: { username: string; display_name: string } | { username: string; display_name: string }[] | null
  comments: { count: number }[]
}

const SELECT = `
  id, user_id, title, author, isbn, note, status, created_at,
  poster:profiles!book_requests_user_id_fkey ( username, display_name ),
  comments ( count )
`

function toView(r: Row, viewerId: string | null): RequestView {
  const p = Array.isArray(r.poster) ? r.poster[0] : r.poster
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    isbn: r.isbn,
    note: r.note,
    status: r.status,
    createdAt: r.created_at.slice(0, 10),
    commentCount: r.comments?.[0]?.count ?? 0,
    isMine: r.user_id === viewerId,
    authorName: p?.display_name ?? 'Тодорхойгүй',
    authorUsername: p?.username ?? '',
  }
}

/** The public feed of open requests. */
export async function getRequestFeed(
  viewerId: string | null,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<RequestView[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('book_requests')
    .select(SELECT)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw error
  return ((data ?? []) as unknown as Row[]).map((r) => toView(r, viewerId))
}

export async function getRequest(
  id: string,
  viewerId: string | null
): Promise<RequestView | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('book_requests').select(SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return null
  return toView(data as unknown as Row, viewerId)
}

/** The viewer's own posts, cancelled ones included. */
export async function getMyRequests(viewerId: string): Promise<RequestView[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('book_requests')
    .select(SELECT)
    .eq('user_id', viewerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as Row[]).map((r) => toView(r, viewerId))
}
