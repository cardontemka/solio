import { getSessionUser } from '@/lib/auth/dal'
import { Header } from './Header'

/**
 * Server wrapper. Everything it needs — identity, unread count, staff flag —
 * arrives in the one session_context() call, so the shell costs a single round
 * trip rather than four.
 */
export async function SiteHeader() {
  const user = await getSessionUser()

  return (
    <Header
      user={
        user
          ? {
              displayName: user.displayName,
              username: user.username,
              avatarUrl: user.avatarUrl,
            }
          : null
      }
      unreadCount={user?.unreadCount ?? 0}
      isStaff={user?.isStaff ?? false}
    />
  )
}
