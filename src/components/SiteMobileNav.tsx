import { getSessionUser } from '@/lib/auth/dal'
import { MobileNav } from './Header'

/**
 * Server wrapper for the bottom bar. The staff flag comes from the same
 * session_context() call the header already made, so this costs no extra round
 * trip — React's cache() hands back the result of the first one.
 */
export async function SiteMobileNav() {
  const user = await getSessionUser()
  return (
    <MobileNav
      isStaff={user?.isStaff ?? false}
      signedIn={Boolean(user)}
      unreadCount={user?.unreadCount ?? 0}
      user={
        user
          ? {
              displayName: user.displayName,
              username: user.username,
              avatarUrl: user.avatarUrl,
            }
          : null
      }
    />
  )
}
