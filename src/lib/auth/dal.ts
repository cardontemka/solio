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
}

/**
 * The single place the app asks "who is calling?". React's cache() dedupes it
 * across a render pass, so calling it in several components costs one round trip.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('username, display_name, city, avatar_key, account_status')
    .eq('id', user.id)
    .single()

  if (!profile) return null

  return {
    id: user.id,
    email: user.email ?? null,
    username: profile.username,
    displayName: profile.display_name,
    city: profile.city,
    avatarUrl: avatarUrl(profile.avatar_key),
    accountStatus: profile.account_status,
  }
})

/** Use in pages. Server Actions must re-check independently. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return user
}
