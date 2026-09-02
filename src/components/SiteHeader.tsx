import { getSessionUser } from '@/lib/auth/dal'
import { getUnreadCount } from '@/features/notifications/queries'
import { isStaff } from '@/features/moderation/queries'
import { Header } from './Header'

/** Server wrapper: resolves the session, unread count and staff flag per request. */
export async function SiteHeader() {
  const user = await getSessionUser()
  const [unreadCount, staff] = user
    ? await Promise.all([getUnreadCount(), isStaff()])
    : [0, false]

  return (
    <Header
      user={user ? { displayName: user.displayName, username: user.username } : null}
      unreadCount={unreadCount}
      isStaff={staff}
    />
  )
}
