'use server'

import 'server-only'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { toUserMessage } from '@/lib/db/errors'

export type NotifState = { ok: true } | { ok: false; message?: string }

/**
 * Only read_at is writable — a database trigger rejects any other column
 * change, so these actions cannot be abused to rewrite a notification's
 * meaning even though RLS grants the recipient UPDATE.
 */

export async function markReadAction(id: number): Promise<NotifState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  const parsed = z.number().int().positive().safeParse(id)
  if (!parsed.success) return { ok: false, message: 'Буруу хүсэлт.' }

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', parsed.data)
    .is('read_at', null)

  if (error) return { ok: false, message: toUserMessage(error, 'markRead') }
  revalidatePath('/notifications')
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function markAllReadAction(): Promise<NotifState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Дахин нэвтэрнэ үү.' }

  // No user filter: RLS already scopes the statement to the caller's rows.
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)

  if (error) return { ok: false, message: toUserMessage(error, 'markAllRead') }
  revalidatePath('/notifications')
  revalidatePath('/', 'layout')
  return { ok: true }
}
