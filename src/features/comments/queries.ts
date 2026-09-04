import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { avatarUrl } from '@/features/users/avatar'

/**
 * Comments hang off whatever they are about — a listing or a request — so the
 * thread a reader sees belongs to the thing on screen and nothing else.
 */
export type CommentView = {
  id: string
  body: string
  createdAt: string
  isMine: boolean
  authorName: string
  authorUsername: string
  authorAvatarUrl: string | null
  isHidden: boolean
}

export type CommentTarget = { listingId: string } | { requestId: string }

type Row = {
  id: string
  body: string
  created_at: string
  user_id: string
  moderation_status: 'active' | 'hidden' | 'removed'
  author:
    | { username: string; display_name: string; avatar_key: string | null }
    | { username: string; display_name: string; avatar_key: string | null }[]
    | null
}

/**
 * RLS returns active comments plus the caller's own, so a hidden comment stays
 * visible to its author (who would otherwise think it vanished) and to staff.
 */
export async function getComments(
  target: CommentTarget,
  viewerId: string | null
): Promise<CommentView[]> {
  const supabase = await createClient()
  const query = supabase
    .from('comments')
    .select(
      `id, body, created_at, user_id, moderation_status,
       author:profiles!comments_user_id_fkey ( username, display_name, avatar_key )`
    )
    .order('created_at', { ascending: false })

  const { data, error } =
    'listingId' in target
      ? await query.eq('book_copy_id', target.listingId)
      : await query.eq('request_id', target.requestId)
  if (error) throw error

  return ((data ?? []) as unknown as Row[]).map((r) => {
    const a = Array.isArray(r.author) ? r.author[0] : r.author
    return {
      id: r.id,
      body: r.body,
      createdAt: r.created_at.slice(0, 10),
      isMine: r.user_id === viewerId,
      authorName: a?.display_name ?? 'Тодорхойгүй',
      authorUsername: a?.username ?? '',
      authorAvatarUrl: avatarUrl(a?.avatar_key),
      isHidden: r.moderation_status !== 'active',
    }
  })
}
