'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
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
