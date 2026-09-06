import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { avatarUrl } from '@/features/users/avatar'
import { bookImageStorage } from '@/lib/storage'

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
  /** Set when the reply offers one of the commenter's own books. */
  offered: { copyId: string; title: string; imageUrl: string | null } | null
  /** One level only — a reply to a reply attaches to the same parent. */
  replies: CommentView[]
}

export type CommentTarget = { listingId: string } | { requestId: string }

type Row = {
  id: string
  body: string
  created_at: string
  user_id: string
  parent_id: string | null
  offered_copy_id: string | null
  moderation_status: 'active' | 'hidden' | 'removed'
  offered:
    | { id: string; books: { title: string } | { title: string }[] | null;
        book_images: { storage_key: string; sort_order: number; status: string }[] }
    | { id: string; books: { title: string } | { title: string }[] | null;
        book_images: { storage_key: string; sort_order: number; status: string }[] }[]
    | null
  author:
    | { username: string; display_name: string; avatar_key: string | null }
    | { username: string; display_name: string; avatar_key: string | null }[]
    | null
}

/**
 * RLS returns active comments plus the caller's own, so a hidden comment stays
 * visible to its author (who would otherwise think it vanished) and to staff.
 */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function offeredOf(r: Row): CommentView['offered'] {
  const copy = one(r.offered)
  if (!copy) return null
  const book = one(copy.books)
  const cover = (copy.book_images ?? [])
    .filter((i) => i.status === 'ready')
    .sort((a, b) => a.sort_order - b.sort_order)[0]
  return {
    copyId: copy.id,
    title: book?.title ?? 'Ном',
    imageUrl: cover ? bookImageStorage().publicUrl(cover.storage_key) : null,
  }
}

export async function getComments(
  target: CommentTarget,
  viewerId: string | null
): Promise<CommentView[]> {
  const supabase = await createClient()
  const query = supabase
    .from('comments')
    .select(
      `id, body, created_at, user_id, parent_id, offered_copy_id, moderation_status,
       author:profiles!comments_user_id_fkey ( username, display_name, avatar_key ),
       offered:book_copies!comments_offered_copy_id_fkey (
         id, books ( title ), book_images ( storage_key, sort_order, status ) )`
    )
    .order('created_at', { ascending: false })

  const { data, error } =
    'listingId' in target
      ? await query.eq('book_copy_id', target.listingId)
      : await query.eq('request_id', target.requestId)
  if (error) throw error

  const rows = (data ?? []) as unknown as Row[]
  const toView = (r: Row): CommentView => {
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
      offered: offeredOf(r),
      replies: [],
    }
  }

  // Newest first at the top level, but a reply reads as a continuation, so
  // replies run oldest first under their parent.
  const byId = new Map<string, CommentView>()
  const roots: CommentView[] = []
  for (const r of rows) byId.set(r.id, toView(r))
  for (const r of rows) {
    const view = byId.get(r.id)!
    if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id)!.replies.push(view)
    else roots.push(view)
  }
  for (const root of roots) root.replies.reverse()
  return roots
}
