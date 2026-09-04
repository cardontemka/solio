'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toUserMessage } from '@/lib/db/errors'
import { flushPendingPush } from '@/lib/push/send'

export type CommentState = { ok: true } | { ok: false; message?: string; errors?: Record<string, string[]> }

const schema = z
  .object({
    listingId: z.guid().optional(),
    requestId: z.guid().optional(),
    parentId: z.guid().optional(),
    body: z.string().trim().min(1, 'Сэтгэгдэл бичнэ үү.').max(4000, 'Сэтгэгдэл хэт урт байна.'),
  })
  // The database enforces the same thing with a check constraint; this only
  // turns a malformed request into a 422 instead of a 23514.
  .refine((v) => Boolean(v.listingId) !== Boolean(v.requestId), {
    message: 'Буруу хүсэлт.',
  })

export async function addCommentAction(
  _prev: CommentState,
  formData: FormData
): Promise<CommentState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const parsed = schema.safeParse({
    listingId: formData.get('listingId') || undefined,
    requestId: formData.get('requestId') || undefined,
    parentId: formData.get('parentId') || undefined,
    body: formData.get('body') ?? '',
  })
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const { listingId, requestId, parentId, body } = parsed.data
  const { data: inserted, error } = await supabase
    .from('comments')
    .insert({
      book_copy_id: listingId ?? null,
      request_id: requestId ?? null,
      parent_id: parentId ?? null,
      user_id: user.id,
      body,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '42501') {
      return { ok: false, message: 'Сэтгэгдлийн хязгаарт хүрсэн эсвэл хаяг тань идэвхгүй байна.' }
    }
    return { ok: false, message: toUserMessage(error, 'addComment') }
  }

  // The notifier runs as the service role because it reads the parent row to
  // find who is being answered; a failure there must not lose the comment.
  try {
    await createAdminClient().rpc('notify_comment', {
      p_comment_id: inserted.id,
      p_actor: user.id,
    })
  } catch (e) {
    console.error('[addComment] notification failed', e)
  }

  // after(): the reader waits for their comment to appear, not for a push
  // service on the other side of the internet.
  after(flushPendingPush)

  revalidatePath(listingId ? `/books/${listingId}` : `/requests/${requestId}`)
  revalidatePath('/requests')
  return { ok: true }
}

export async function deleteCommentAction(
  commentId: string,
  path: string
): Promise<CommentState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }
  if (!z.guid().safeParse(commentId).success) return { ok: false, message: 'Буруу хүсэлт.' }

  // No user filter: RLS decides which row is reachable.
  const { error } = await supabase.from('comments').delete().eq('id', commentId)
  if (error) return { ok: false, message: toUserMessage(error, 'deleteComment') }

  if (path.startsWith('/')) revalidatePath(path)
  return { ok: true }
}
