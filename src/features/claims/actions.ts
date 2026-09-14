'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { toUserMessage } from '@/lib/db/errors'

export type ClaimState =
  | { ok: true; claimId: string; copyId: string }
  | { ok: false; message: string }

/**
 * "I have this thing." Raised by whoever is holding the item, against the code
 * printed on it, and worth nothing until the owner agrees.
 *
 * Deliberately not gated on the scanner being anybody in particular: a café
 * takes custody, a person takes ownership, and which of those is on offer is
 * decided by the account, not by the code. The database refuses a storage claim
 * from an account with no premises.
 */
export async function claimByCodeAction(
  code: string,
  kind: 'storage' | 'ownership',
  note?: string
): Promise<ClaimState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const { data, error } = await supabase.rpc('claim_by_code', {
    p_code: code,
    p_kind: kind,
    p_note: note?.trim() || null,
  })
  if (error) return { ok: false, message: toUserMessage(error, 'claimByCode') }

  const row = (data ?? [])[0] as { claim_id: string; copy_id: string } | undefined
  if (!row) return { ok: false, message: 'Хүсэлт үүсгэж чадсангүй.' }

  revalidatePath(`/books/${row.copy_id}`)
  revalidatePath('/dashboard')
  revalidatePath('/my-books')
  return { ok: true, claimId: row.claim_id, copyId: row.copy_id }
}

export type DecisionState = { ok: true } | { ok: false; message: string }

/**
 * The owner's answer — or the claimant withdrawing.
 *
 * Approving is what actually moves the thing: custody to the venue, or
 * ownership outright, with a ledger entry either way. The checks that matter
 * run again inside the transaction, because the claim may be days old by now.
 */
export async function respondToClaimAction(
  claimId: string,
  action: 'approve' | 'reject' | 'cancel'
): Promise<DecisionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const { error } = await supabase.rpc('respond_to_claim', {
    p_claim_id: claimId,
    p_action: action,
  })
  if (error) return { ok: false, message: toUserMessage(error, 'respondToClaim') }

  revalidatePath('/dashboard')
  revalidatePath('/my-books')
  revalidatePath('/notifications')
  revalidatePath('/', 'layout')
  return { ok: true }
}
