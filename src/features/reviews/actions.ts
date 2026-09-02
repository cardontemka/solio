'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toUserMessage } from '@/lib/db/errors'
import { emailNotification } from '@/lib/email/notifications'

export type ReviewState = { ok: true } | { ok: false; message?: string; errors?: Record<string, string[]> }

const schema = z.object({
  bookId: z.guid(),
  rating: z.coerce.number().int().min(1, 'Үнэлгээгээ сонгоно уу.').max(5),
  body: z.string().trim().max(4000, 'Сэтгэгдэл хэт урт байна.').optional(),
})

/**
 * Insert or update in one action: the unique(user_id, book_id) constraint is
 * the rule, so "already reviewed" is not an error to surface but a signal to
 * edit the existing row.
 */
export async function upsertReviewAction(
  _prev: ReviewState,
  formData: FormData
): Promise<ReviewState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const parsed = schema.safeParse({
    bookId: formData.get('bookId'),
    rating: formData.get('rating'),
    body: formData.get('body') ?? '',
  })
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const { bookId, rating, body } = parsed.data
  const { data: existing } = await supabase
    .from('book_reviews')
    .select('id')
    .eq('book_id', bookId)
    .eq('user_id', user.id)
    .maybeSingle()

  const { error } = existing
    ? await supabase
        .from('book_reviews')
        .update({ rating, body: body || null })
        .eq('id', existing.id)
    : await supabase
        .from('book_reviews')
        .insert({ book_id: bookId, user_id: user.id, rating, body: body || null })

  if (error) {
    if (error.code === '42501') {
      return { ok: false, message: 'Сэтгэгдлийн хязгаарт хүрсэн эсвэл данс идэвхгүй байна.' }
    }
    return { ok: false, message: toUserMessage(error, 'upsertReview') }
  }

  // Only a new review is worth announcing; editing your own wording is not.
  if (!existing) {
    try {
      await createAdminClient().rpc('notify_review', { p_book_id: bookId, p_actor: user.id })
    } catch (e) {
      console.error('[upsertReview] notification failed', e)
    }
    await emailReviewOwners(bookId, user.id)
  }

  revalidatePath(`/books/${bookId}`)
  revalidatePath('/')
  return { ok: true }
}

export async function deleteReviewAction(reviewId: string, bookId: string): Promise<ReviewState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }
  if (!z.guid().safeParse(reviewId).success) return { ok: false, message: 'Буруу хүсэлт.' }

  // No user filter: RLS decides which row is reachable.
  const { error } = await supabase.from('book_reviews').delete().eq('id', reviewId)
  if (error) return { ok: false, message: toUserMessage(error, 'deleteReview') }

  revalidatePath(`/books/${bookId}`)
  revalidatePath('/')
  return { ok: true }
}

/**
 * Best-effort email to the owners who got a 'review_received' notification —
 * the same up-to-20 recipients the DB chooses. The reviewer's own client can't
 * see other people's copies, so this reads through the admin client.
 */
async function emailReviewOwners(bookId: string, actorId: string) {
  try {
    const { data } = await createAdminClient()
      .from('book_copies')
      .select('owner_id')
      .eq('book_id', bookId)
      .eq('status', 'available')
      .eq('moderation_status', 'active')
      .neq('owner_id', actorId)
      .limit(20)
    const ownerIds = Array.from(
      new Set(((data ?? []) as { owner_id: string }[]).map((r) => r.owner_id))
    )
    await Promise.all(
      ownerIds.map((id) =>
        emailNotification({ userId: id, type: 'review_received', entityType: 'book', entityId: bookId })
      )
    )
  } catch (e) {
    console.error('[upsertReview] email failed', e)
  }
}
