'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { toUserMessage } from '@/lib/db/errors'

export type SwapActionState = { ok: true } | { ok: false; message?: string }

// z.guid(), not z.uuid(): a Postgres `uuid` column accepts any 32-hex layout,
// including ids that carry no RFC-4122 version nibble. uuid() would reject
// those as malformed and turn a valid row id into "bad request".
const idSchema = z.guid()

/**
 * Each action takes ids only — never a status, an owner, or a swap object.
 * A well-formed object from the client could still point at a row the caller
 * does not own; the RPC re-reads everything from the database after locking.
 */

export async function requestSwapAction(
  _prev: SwapActionState,
  formData: FormData
): Promise<SwapActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const offered = idSchema.safeParse(formData.get('offeredCopyId'))
  const requested = idSchema.safeParse(formData.get('requestedCopyId'))
  if (!offered.success || !requested.success) {
    return { ok: false, message: 'Ном сонгоно уу.' }
  }

  const message = String(formData.get('message') ?? '').trim().slice(0, 2000)
  const { error } = await supabase.rpc('request_swap', {
    p_offered_copy_id: offered.data,
    p_requested_copy_id: requested.data,
    p_message: message || null,
  })
  if (error) return { ok: false, message: toUserMessage(error, 'requestSwap') }

  revalidatePath('/swaps')
  revalidatePath('/my-books')
  return { ok: true }
}

async function respond(swapId: string, action: 'accept' | 'reject' | 'cancel') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, message: 'Дахин нэвтэрнэ үү.' }

  const id = idSchema.safeParse(swapId)
  if (!id.success) return { ok: false as const, message: 'Буруу хүсэлт.' }

  const { error } = await supabase.rpc('respond_to_swap', {
    p_swap_id: id.data,
    p_action: action,
  })
  if (error) return { ok: false as const, message: toUserMessage(error, `swap.${action}`) }

  revalidatePath('/swaps')
  revalidatePath('/my-books')
  return { ok: true as const }
}

export async function acceptSwapAction(swapId: string) { return respond(swapId, 'accept') }
export async function rejectSwapAction(swapId: string) { return respond(swapId, 'reject') }
export async function cancelSwapAction(swapId: string) { return respond(swapId, 'cancel') }

/**
 * Two-phase: the first call moves ACCEPTED → CONFIRMED and records who
 * confirmed; the second, by the OTHER party, transfers ownership. The database
 * refuses to let one person do both.
 */
export async function completeSwapAction(swapId: string): Promise<SwapActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const id = idSchema.safeParse(swapId)
  if (!id.success) return { ok: false, message: 'Буруу хүсэлт.' }

  const { error } = await supabase.rpc('complete_swap', { p_swap_id: id.data })
  if (error) return { ok: false, message: toUserMessage(error, 'completeSwap') }

  revalidatePath('/swaps')
  revalidatePath('/my-books')
  revalidatePath('/')
  return { ok: true }
}
