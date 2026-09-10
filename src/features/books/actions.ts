'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { toUserMessage } from '@/lib/db/errors'
import { attributesFrom, createBookSchema } from './schema'

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
    kind: formData.get('kind') ?? 'book',
    title: formData.get('title') ?? '',
    author: formData.get('author') ?? '',
    isbn: formData.get('isbn') ?? '',
    publisher: formData.get('publisher') ?? '',
    language: formData.get('language') ?? 'mn',
    description: formData.get('description') ?? '',
    publishedYear: formData.get('publishedYear') ?? '',
    categories: formData.getAll('categories').map(String),
    weightG: formData.get('weightG') ?? '',
    sizeNote: formData.get('sizeNote') ?? '',
    condition: formData.get('condition') ?? 'good',
    conditionNote: formData.get('conditionNote') ?? '',
    bookId: formData.get('bookId') ?? '',
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
    p_categories: v.categories,
    p_weight_g: typeof v.weightG === 'number' ? v.weightG : null,
    p_size_note: v.sizeNote || null,
    p_kind: v.kind,
    p_attributes: attributesFrom(v.kind, formData),
    // Attaches this copy to a catalogue row that already exists — but only if
    // what was submitted still matches it. The check is in the database, so
    // this is a hint rather than a claim.
    p_book_id: v.bookId || null,
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

/**
 * Re-offer a listing that is finished or taken down. The legal edges are
 * enforced by the DB guard; this only names the one the owner asked for.
 */
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
  revalidatePath('/dashboard')
  revalidatePath(`/books/${copyId}`)
  revalidatePath('/')
  return { ok: true }
}

/**
 * Edit a listing. Two rows change — the catalogue fields on `books`, the
 * physical ones on `book_copies` — and `books` has no update policy at all, so
 * this goes through an RPC that checks ownership itself.
 */
export async function updateListingAction(
  copyId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const parsed = createBookSchema.safeParse({
    kind: formData.get('kind') ?? 'book',
    title: formData.get('title') ?? '',
    author: formData.get('author') ?? '',
    isbn: formData.get('isbn') ?? '',
    publisher: formData.get('publisher') ?? '',
    language: formData.get('language') ?? 'mn',
    description: formData.get('description') ?? '',
    publishedYear: formData.get('publishedYear') ?? '',
    categories: formData.getAll('categories').map(String),
    weightG: formData.get('weightG') ?? '',
    sizeNote: formData.get('sizeNote') ?? '',
    condition: formData.get('condition') ?? 'good',
    conditionNote: formData.get('conditionNote') ?? '',
  })
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const v = parsed.data
  const { error } = await supabase.rpc('update_listing', {
    p_copy_id: copyId,
    p_title: v.title,
    p_author: v.author || null,
    p_isbn: v.isbn || null,
    p_publisher: v.publisher || null,
    p_language: v.language === 'other' ? null : (v.language ?? null),
    p_description: v.description || null,
    p_published_year: typeof v.publishedYear === 'number' ? v.publishedYear : null,
    p_condition: v.condition,
    p_condition_note: v.conditionNote || null,
    p_categories: v.categories,
    p_weight_g: typeof v.weightG === 'number' ? v.weightG : null,
    p_size_note: v.sizeNote || null,
    p_kind: v.kind,
    p_attributes: attributesFrom(v.kind, formData),
  })
  if (error) return { ok: false, message: toUserMessage(error, 'updateListing') }

  revalidatePath(`/books/${copyId}`)
  revalidatePath('/my-books')
  revalidatePath('/dashboard')
  revalidatePath('/')
  // Server-side, so the form never has to navigate from inside a render.
  redirect(`/books/${copyId}`)
}

/**
 * Delete a listing outright. The RPC refuses while a swap is live — that
 * listing is a promise to somebody else until the swap ends.
 */
export async function deleteListingAction(copyId: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const { data, error } = await supabase.rpc('delete_listing', { p_copy_id: copyId })
  if (error) {
    if (error.message.includes('LISTING_IN_ACTIVE_SWAP')) {
      return {
        ok: false,
        message: 'Энэ ном идэвхтэй солилцоонд байна. Эхлээд солилцоог дуусгах эсвэл цуцлана уу.',
      }
    }
    if (error.message.includes('NOT_YOUR_LISTING')) {
      return { ok: false, message: 'Зөвхөн өөрийн номоо устгана.' }
    }
    return { ok: false, message: toUserMessage(error, 'deleteListing') }
  }

  // The rows are gone; the photos they pointed at are not, until now. The RPC
  // returns the keys because the database cannot reach the bucket itself.
  const keys = ((data ?? []) as { storage_key: string }[]).map((r) => r.storage_key)
  if (keys.length > 0) {
    const storage = bookImageStorage()
    await Promise.all(
      keys.map((key) =>
        storage.delete(key).catch((e) => {
          console.error('[deleteListingAction] orphaned object', key, (e as Error).message)
        })
      )
    )
  }

  revalidatePath('/my-books')
  revalidatePath('/dashboard')
  revalidatePath('/')
  return { ok: true }
}
