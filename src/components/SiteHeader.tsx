import { getSessionUser } from '@/lib/auth/dal'
import { getUnreadCount } from '@/features/notifications/queries'
import { Header } from './Header'

/** Server wrapper: resolves the session and unread count once per request. */
export async function SiteHeader() {
  const user = await getSessionUser()
  const unreadCount = user ? await getUnreadCount() : 0

  return (
    <Header
      user={user ? { displayName: user.displayName, username: user.username } : null}
      unreadCount={unreadCount}
    />
  )
}
