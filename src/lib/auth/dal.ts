import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { avatarUrl } from '@/features/users/avatar'

export type SessionUser = {
  id: string
  email: string | null
  username: string
  displayName: string
  city: string | null
  avatarUrl: string | null
  accountStatus: string
  /** A person, or a venue that holds other people's books. */
  accountType: 'person' | 'storage_point'
  /** Credits: one earned per book given to a storage point, one spent per book taken. */
  credits: number
  /** Moderator or admin. Carried here because the shell needs it every page. */
  isStaff: boolean
  /** Admin alone. Hiding content is a moderator's; destroying it is not. */
  isAdmin: boolean
  unreadCount: number
}

/**
 * The single place the app asks "who is calling?".
 *
 * One RPC, not four calls: the header used to validate the token, read the
 * profile, count unread notifications and look up staff roles separately, which
 * is four round trips to another region before anything renders. auth.uid()
 * inside the function reads the JWT PostgREST already verified, so a separate
 * auth.getUser() adds nothing but latency.
 *
 * React's cache() dedupes it across a render pass, so calling it from the
 * header and from a page costs one round trip in total.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('session_context')
  if (error) {
    console.error('[dal] session_context', error.code, error.message)
    return null
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        user_id: string
        email: string | null
        username: string
        display_name: string
        city: string | null
        avatar_key: string | null
        account_status: string
        account_type: string
        is_staff: boolean
        is_admin: boolean
        unread_count: number
        credits: number
      }
    | undefined
  if (!row) return null

  return {
    id: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    city: row.city,
    avatarUrl: avatarUrl(row.avatar_key),
    accountStatus: row.account_status,
    accountType: row.account_type === 'storage_point' ? 'storage_point' : 'person',
    credits: row.credits ?? 0,
    isStaff: row.is_staff,
    isAdmin: row.is_admin ?? false,
    unreadCount: row.unread_count,
  }
})

/** Use in pages. Server Actions must re-check independently. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return user
}
