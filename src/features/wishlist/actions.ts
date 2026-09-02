'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { toUserMessage } from '@/lib/db/errors'

export type WishState = { ok: true } | { ok: false; message?: string; errors?: Record<string, string[]> }

const createSchema = z.object({
  title: z.string().trim().min(1, 'Номын нэрийг оруулна уу.').max(300),
  author: z.string().trim().max(200).optional(),
  isbn: z
    .string()
    .trim()
    .max(32)
    .refine((v) => v === '' || /^[0-9Xx\- ]+$/.test(v), 'ISBN нь зөвхөн тоо, зураас байна.')
    .optional(),
  note: z.string().trim().max(500).optional(),
})

/**
 * user_id is taken from the session, never the form: RLS additionally refuses
 * any row whose user_id is not the caller, so a forged field has nothing to
 * bind to. The rate limit lives in the policy's WITH CHECK.
 */
export async function createRequestAction(
  _prev: WishState,
  formData: FormData
): Promise<WishState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const parsed = createSchema.safeParse({
    title: formData.get('title') ?? '',
    author: formData.get('author') ?? '',
    isbn: formData.get('isbn') ?? '',
    note: formData.get('note') ?? '',
  })
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const bookIdRaw = formData.get('bookId')
  const bookId = typeof bookIdRaw === 'string' && z.guid().safeParse(bookIdRaw).success
    ? bookIdRaw
    : null

  const { error } = await supabase.from('book_requests').insert({
    user_id: user.id,
    book_id: bookId,
    title: parsed.data.title,
    author: parsed.data.author || null,
    isbn: parsed.data.isbn || null,
    note: parsed.data.note || null,
  })

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Та энэ номыг аль хэдийн жагсаалтдаа нэмсэн байна.' }
    }
    if (error.code === '42501') {
      return { ok: false, message: 'Хүсэлтийн хязгаарт хүрсэн эсвэл данс идэвхгүй байна.' }
    }
    return { ok: false, message: toUserMessage(error, 'createRequest') }
  }

  revalidatePath('/wishlist')
  return { ok: true }
}

export async function cancelRequestAction(id: string): Promise<WishState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }
  if (!z.guid().safeParse(id).success) return { ok: false, message: 'Буруу хүсэлт.' }

  // No user filter: RLS decides which row is reachable.
  const { error } = await supabase
    .from('book_requests')
    .update({ status: 'cancelled' })
    .eq('id', id)

  if (error) return { ok: false, message: toUserMessage(error, 'cancelRequest') }
  revalidatePath('/wishlist')
  return { ok: true }
}

export async function deleteRequestAction(id: string): Promise<WishState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }
  if (!z.guid().safeParse(id).success) return { ok: false, message: 'Буруу хүсэлт.' }

  const { error } = await supabase.from('book_requests').delete().eq('id', id)
  if (error) return { ok: false, message: toUserMessage(error, 'deleteRequest') }
  revalidatePath('/wishlist')
  return { ok: true }
}
