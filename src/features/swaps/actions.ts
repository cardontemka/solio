'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { toUserMessage } from '@/lib/db/errors'
import { emailNotification } from '@/lib/email/notifications'

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

  await emailRequestedOwner(requested.data, user.id)

  revalidatePath('/swaps')
  revalidatePath('/my-books')
  return { ok: true }
}

type SwapEmailType =
  | 'swap_accepted'
  | 'swap_rejected'
  | 'swap_cancelled'
  | 'swap_confirmed'
  | 'swap_completed'

const respondEmail: Record<'accept' | 'reject' | 'cancel', SwapEmailType> = {
  accept: 'swap_accepted',
  reject: 'swap_rejected',
  cancel: 'swap_cancelled',
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

  await emailSwapNotification(id.data, user.id, respondEmail[action])

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

  // Phase 1 (ACCEPTED → CONFIRMED) announces handover; phase 2 (→ COMPLETED)
  // announces the finished swap. Read the post-RPC status to pick the right one.
  const { data: after } = await supabase
    .from('swaps')
    .select('status')
    .eq('id', id.data)
    .single()
  await emailSwapNotification(
    id.data,
    user.id,
    after?.status === 'COMPLETED' ? 'swap_completed' : 'swap_confirmed'
  )

  revalidatePath('/swaps')
  revalidatePath('/my-books')
  revalidatePath('/')
  return { ok: true }
}

/** Best-effort email to the owner of the requested copy (the swap recipient). */
async function emailRequestedOwner(requestedCopyId: string, actorId: string) {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('book_copies')
      .select('owner_id')
      .eq('id', requestedCopyId)
      .single()
    if (data?.owner_id && data.owner_id !== actorId) {
      await emailNotification({
        userId: data.owner_id,
        type: 'swap_requested',
        entityType: 'swap',
        entityId: requestedCopyId,
      })
    }
  } catch (e) {
    console.error('[requestSwap] email failed', e)
  }
}

/** Best-effort email to the swap's counterparty (nobody is the actor). */
async function emailSwapNotification(swapId: string, actorId: string, type: SwapEmailType) {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('swaps')
      .select('requester_id, responder_id')
      .eq('id', swapId)
      .single()
    const recipient =
      data?.requester_id === actorId ? data.responder_id : data?.requester_id
    if (recipient) {
      await emailNotification({ userId: recipient, type, entityType: 'swap', entityId: swapId })
    }
  } catch (e) {
    console.error('[swap] email failed', e)
  }
}
