'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { toUserMessage } from '@/lib/db/errors'
import { createBookSchema } from './schema'

export type ActionState =
  | { ok: true; bookId?: string; copyId?: string }
  | { ok: false; message?: string; errors?: Record<string, string[]> }

/**
 * A Server Action is a POST to whatever route it is used from — a page-level
 * auth check does NOT extend to it. So it authenticates, validates and
 * authorises independently, every time.
 *
 * Note what is NOT trusted from the client: the owner. The RPC takes no user
 * id at all and reads auth.uid() itself, so a forged field has nothing to bind
 * to. Ownership, the rate limit and the ledger entry are all enforced in the
 * database, inside one transaction.
 */
export async function createBookAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const parsed = createBookSchema.safeParse({
    title: formData.get('title') ?? '',
    author: formData.get('author') ?? '',
    isbn: formData.get('isbn') ?? '',
    publisher: formData.get('publisher') ?? '',
    language: formData.get('language') ?? 'mn',
    description: formData.get('description') ?? '',
    publishedYear: formData.get('publishedYear') ?? '',
    condition: formData.get('condition') ?? 'good',
    conditionNote: formData.get('conditionNote') ?? '',
  })

  if (!parsed.success) {
    const flat = parsed.error.flatten()
    return { ok: false, errors: flat.fieldErrors as Record<string, string[]> }
  }

  const v = parsed.data
  const { data, error } = await supabase.rpc('create_book_with_copy', {
    p_title: v.title,
    p_author: v.author || null,
    p_isbn: v.isbn || null,
    p_publisher: v.publisher || null,
    p_language: v.language === 'other' ? null : (v.language ?? null),
    p_description: v.description || null,
    p_published_year: typeof v.publishedYear === 'number' ? v.publishedYear : null,
    p_condition: v.condition,
    p_condition_note: v.conditionNote || null,
  })

  if (error) return { ok: false, message: toUserMessage(error, 'createBookAction') }

  const bookId = Array.isArray(data) ? data[0]?.book_id : undefined
  const copyId = Array.isArray(data) ? data[0]?.copy_id : undefined

  revalidatePath('/my-books')
  revalidatePath('/')

  // Defer the redirect so the Add Book page can run the image-upload step
  // first (uploads are tied to the copy, which now exists).
  return { ok: true, bookId, copyId }
}

/** Owner-driven visibility toggle. The legal edges are enforced by the DB guard. */
export async function setCopyVisibilityAction(
  copyId: string,
  next: 'available' | 'inactive'
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  // No owner filter here on purpose: RLS decides which row is reachable.
  const { error } = await supabase
    .from('book_copies')
    .update({ status: next })
    .eq('id', copyId)

  if (error) return { ok: false, message: toUserMessage(error, 'setCopyVisibility') }

  revalidatePath('/my-books')
  return { ok: true }
}
