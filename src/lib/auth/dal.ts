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
  /** Moderator or admin. Carried here because the shell needs it every page. */
  isStaff: boolean
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
        is_staff: boolean
        unread_count: number
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
    isStaff: row.is_staff,
    unreadCount: row.unread_count,
  }
})

/** Use in pages. Server Actions must re-check independently. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return user
}
