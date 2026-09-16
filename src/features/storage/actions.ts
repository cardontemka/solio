'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { bookImageStorage } from '@/lib/storage'
import { sniffMime } from '@/lib/storage/verify'
import { toUserMessage } from '@/lib/db/errors'
import { storagePointFrom } from './schema'

export type StorageState =
  | { ok: true }
  | { ok: false; message?: string; errors?: Record<string, string[]> }

/**
 * The venue handing a stored book back to its owner.
 *
 * Only the venue currently holding it may call this, and that is the point: an
 * owner cannot declare where their own book is, including that it is no longer
 * at the café. Whoever has it on their shelf is who knows.
 */
export async function releaseStoredAction(copyId: string): Promise<StorageState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const { error } = await supabase.rpc('release_stored', { p_copy_id: copyId })
  if (error) return { ok: false, message: toUserMessage(error, 'releaseStored') }

  revalidatePath(`/books/${copyId}`)
  revalidatePath('/storage-points')
  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Edit the premises.
 *
 * Straight through RLS: storage_points_update_own already scopes the row to the
 * caller and the trigger refuses to let profile_id move, so there is nothing
 * here for an elevated client to do.
 */
export async function updateStoragePointAction(
  _prev: StorageState,
  formData: FormData
): Promise<StorageState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const parsed = storagePointFrom(formData)
  if (!parsed.success) {
    // Prefixed the way the boxes are named, so each message lands under its own.
    const flat = parsed.error.flatten().fieldErrors as Record<string, string[]>
    const errors: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(flat)) errors[`sp_${key}`] = value
    return { ok: false, errors }
  }

  const v = parsed.data
  const { error } = await supabase
    .from('storage_points')
    .update({
      name: v.name,
      kind: v.kind,
      city: v.city,
      district: v.district,
      address: v.address,
      landmark: v.landmark || null,
      phone: v.phone,
      hours: v.hours,
      capacity: typeof v.capacity === 'number' ? v.capacity : null,
      website: v.website || null,
      description: v.description || null,
    })
    .eq('profile_id', user.id)

  if (error) return { ok: false, message: toUserMessage(error, 'updateStoragePoint') }

  // The city on the profile is what the header and the cards show, and for a
  // venue it should be the venue's city rather than whatever was typed at
  // signup. Kept in step here rather than by a trigger: it is a display default,
  // not a rule about the data.
  await supabase.from('profiles').update({ city: v.city }).eq('id', user.id)

  revalidatePath('/settings')
  revalidatePath('/storage-points')
  revalidatePath('/', 'layout')
  return { ok: true }
}

export type CoverState = { ok: true; url: string | null } | { ok: false; message: string }

/**
 * Attaches an uploaded cover photo to the caller's own storage point.
 *
 * Same rule as avatars and book photos: a declared MIME type is not taken on
 * trust. The object's head is read back from the bucket and sniffed, and
 * anything that is not really an image is deleted rather than linked — the
 * alternative is arbitrary bytes served from the image host under a venue's
 * name. The key is rebuilt from the caller's own id too, so a forged one cannot
 * point at somebody else's object.
 */
export async function setStoragePointCoverAction(storageKey: string): Promise<CoverState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const expectedPrefix = `covers/${user.id}/`
  if (!storageKey.startsWith(expectedPrefix) || storageKey.includes('..')) {
    return { ok: false, message: 'Буруу хүсэлт.' }
  }

  const storage = bookImageStorage()
  const head = await storage.readHead(storageKey, 64)
  if (!head || !sniffMime(head)) {
    await storage.delete(storageKey).catch(() => {})
    return { ok: false, message: 'Файл зураг биш байна.' }
  }

  const { data: previous } = await supabase
    .from('storage_points')
    .select('cover_key')
    .eq('profile_id', user.id)
    .maybeSingle()

  const { error } = await supabase
    .from('storage_points')
    .update({ cover_key: storageKey })
    .eq('profile_id', user.id)
  if (error) {
    await storage.delete(storageKey).catch(() => {})
    return { ok: false, message: toUserMessage(error, 'setStoragePointCover') }
  }

  // The old object is now unreachable; leaving it would grow the bucket for
  // every change of picture.
  const old = (previous as { cover_key: string | null } | null)?.cover_key
  if (old && old !== storageKey) await storage.delete(old).catch(() => {})

  revalidatePath('/settings')
  revalidatePath('/storage-points')
  revalidatePath('/', 'layout')
  return { ok: true, url: storage.publicUrl(storageKey) }
}

export async function removeStoragePointCoverAction(): Promise<CoverState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const { data: previous } = await supabase
    .from('storage_points')
    .select('cover_key')
    .eq('profile_id', user.id)
    .maybeSingle()

  const { error } = await supabase
    .from('storage_points')
    .update({ cover_key: null })
    .eq('profile_id', user.id)
  if (error) return { ok: false, message: toUserMessage(error, 'removeStoragePointCover') }

  const old = (previous as { cover_key: string | null } | null)?.cover_key
  if (old) await bookImageStorage().delete(old).catch(() => {})

  revalidatePath('/settings')
  revalidatePath('/storage-points')
  revalidatePath('/', 'layout')
  return { ok: true, url: null }
}
