'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { toUserMessage } from '@/lib/db/errors'

export type RequestState =
  | { ok: true; id?: string }
  | { ok: false; message?: string; errors?: Record<string, string[]> }

const schema = z.object({
  title: z.string().trim().min(1, 'Нэрийг нь бичнэ үү.').max(300, 'Хэт урт байна.'),
  author: z.string().trim().max(200, 'Хэт урт байна.').optional(),
  isbn: z.string().trim().max(32, 'Хэт урт байна.').optional(),
  note: z.string().trim().max(500, 'Тайлбар 500 тэмдэгтээс их байж болохгүй.').optional(),
})

/** Post a request: "I am looking for this book." */
export async function createRequestAction(
  _prev: RequestState,
  formData: FormData
): Promise<RequestState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const parsed = schema.safeParse({
    title: formData.get('title'),
    author: formData.get('author') ?? '',
    isbn: formData.get('isbn') ?? '',
    note: formData.get('note') ?? '',
  })
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const { title, author, isbn, note } = parsed.data
  const { data, error } = await supabase
    .from('book_requests')
    .insert({
      user_id: user.id,
      title,
      author: author || null,
      isbn: isbn || null,
      note: note || null,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '42501') {
      return { ok: false, message: 'Хүсэлтийн хязгаарт хүрсэн эсвэл хаяг тань идэвхгүй байна.' }
    }
    return { ok: false, message: toUserMessage(error, 'createRequest') }
  }

  revalidatePath('/requests')
  revalidatePath('/')
  revalidatePath('/dashboard')
  return { ok: true, id: data.id }
}

async function setStatus(id: string, status: 'open' | 'fulfilled' | 'cancelled'): Promise<RequestState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }
  if (!z.guid().safeParse(id).success) return { ok: false, message: 'Буруу хүсэлт.' }

  // No user filter: RLS decides which row is reachable.
  const { error } = await supabase
    .from('book_requests')
    .update({
      status,
      fulfilled_at: status === 'fulfilled' ? new Date().toISOString() : null,
    })
    .eq('id', id)
  if (error) return { ok: false, message: toUserMessage(error, 'request.' + status) }

  revalidatePath('/requests')
  revalidatePath(`/requests/${id}`)
  revalidatePath('/dashboard')
  revalidatePath('/')
  return { ok: true }
}

/** Found the book — the post stays readable but stops asking. */
export async function fulfillRequestAction(id: string) {
  return setStatus(id, 'fulfilled')
}

export async function reopenRequestAction(id: string) {
  return setStatus(id, 'open')
}

export async function cancelRequestAction(id: string) {
  return setStatus(id, 'cancelled')
}

export async function deleteRequestAction(id: string): Promise<RequestState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }
  if (!z.guid().safeParse(id).success) return { ok: false, message: 'Буруу хүсэлт.' }

  const { error } = await supabase.from('book_requests').delete().eq('id', id)
  if (error) return { ok: false, message: toUserMessage(error, 'deleteRequest') }

  revalidatePath('/requests')
  revalidatePath('/dashboard')
  revalidatePath('/')
  return { ok: true }
}
