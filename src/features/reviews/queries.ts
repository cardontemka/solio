import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type ReviewView = {
  id: string
  rating: number
  body: string | null
  createdAt: string
  isMine: boolean
  authorName: string
  authorUsername: string
  isHidden: boolean
}

type Row = {
  id: string
  rating: number
  body: string | null
  created_at: string
  user_id: string
  moderation_status: 'active' | 'hidden' | 'removed'
  author: { username: string; display_name: string } | { username: string; display_name: string }[] | null
}

/**
 * RLS returns active reviews plus the caller's own, so a hidden review stays
 * visible to its author (who would otherwise think it vanished) and to staff.
 */
export async function getReviewsForBook(
  bookId: string,
  viewerId: string | null
): Promise<ReviewView[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('book_reviews')
    .select(
      `id, rating, body, created_at, user_id, moderation_status,
       author:profiles!book_reviews_user_id_fkey ( username, display_name )`
    )
    .eq('book_id', bookId)
    .order('created_at', { ascending: false })
  if (error) throw error

  return ((data ?? []) as unknown as Row[]).map((r) => {
    const a = Array.isArray(r.author) ? r.author[0] : r.author
    return {
      id: r.id,
      rating: r.rating,
      body: r.body,
      createdAt: r.created_at.slice(0, 10),
      isMine: r.user_id === viewerId,
      authorName: a?.display_name ?? 'Тодорхойгүй',
      authorUsername: a?.username ?? '',
      isHidden: r.moderation_status !== 'active',
    }
  })
}

export async function getMyReview(bookId: string, viewerId: string | null) {
  if (!viewerId) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('book_reviews')
    .select('id, rating, body')
    .eq('book_id', bookId)
    .eq('user_id', viewerId)
    .maybeSingle()
  return data as { id: string; rating: number; body: string | null } | null
}
