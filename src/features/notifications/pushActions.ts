'use server'

import 'server-only'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isPushConfigured } from '@/lib/push/config'

export type PushState = { ok: true } | { ok: false; message: string }

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  p256dh: z.string().min(8).max(400),
  auth: z.string().min(8).max(200),
  userAgent: z.string().max(400).optional(),
})

/**
 * Stores this browser's push address against the signed-in account.
 *
 * Endpoints are unique, so re-subscribing in the same browser updates the row
 * rather than adding a second one — otherwise every notification would arrive
 * twice after a key rotation.
 */
export async function savePushSubscriptionAction(input: unknown): Promise<PushState> {
  if (!isPushConfigured()) return { ok: false, message: 'Push мэдэгдэл тохируулагдаагүй байна.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const parsed = subscriptionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Буруу хүсэлт.' }

  const { endpoint, p256dh, auth, userAgent } = parsed.data

  // A browser's endpoint can migrate between accounts on a shared device, so
  // the old row is cleared first rather than left pointing at someone else.
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)

  const { error } = await supabase.from('push_subscriptions').insert({
    user_id: user.id,
    endpoint,
    p256dh,
    auth,
    user_agent: userAgent ?? null,
  })
  if (error) {
    console.error('[push] save failed', error.code, error.message)
    return { ok: false, message: 'Мэдэгдлийг идэвхжүүлж чадсангүй.' }
  }
  return { ok: true }
}

export async function removePushSubscriptionAction(endpoint: string): Promise<PushState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  // RLS scopes this to the caller's own rows.
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) return { ok: false, message: 'Унтраахад алдаа гарлаа.' }
  return { ok: true }
}
