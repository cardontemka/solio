import { ButtonLink } from '@/components/ui'
import { UserDashboard, type PanelKey } from '@/components/UserDashboard'
import { MyBooksPanel } from '@/features/books/MyBooksPanel'
import { getMyCopies } from '@/features/books/queries'
import { MyRequestsPanel } from '@/features/requests/MyRequestsPanel'
import { getMyRequests } from '@/features/requests/queries'
import { SwapsPanel } from '@/features/swaps/SwapsPanel'
import { getMySwaps } from '@/features/swaps/queries'
import { requireUser } from '@/lib/auth/dal'

/**
 * One shell over the same panels /my-books, /requests and /swaps render.
 * It lives at /dashboard rather than /u/<username> because everything on it is
 * the viewer's own — nobody else can ever see this page — which leaves the /u/
 * namespace free for a real public profile later.
 */
export const metadata = {
  title: 'Миний хуудас',
  robots: { index: false, follow: false },
}

export default async function DashboardPage() {
  const me = await requireUser()
  const [copies, requests, swaps] = await Promise.all([
    getMyCopies(me.id),
    getMyRequests(me.id),
    getMySwaps(me.id),
  ])

  const panels: Record<PanelKey, React.ReactNode> = {
    books: (
      <MyBooksPanel
        copies={copies}
        emptyAction={<ButtonLink href="/books/new">Ном нэмэх</ButtonLink>}
      />
    ),
    wishlist: <MyRequestsPanel requests={requests} />,
    swaps: <SwapsPanel swaps={swaps} />,
  }

  return (
    <div className="container">
      <UserDashboard
        initialPanel="books"
        panels={panels}
        userInfo={{
          name: me.displayName,
          username: me.username,
          email: me.email,
          city: me.city,
          avatarUrl: me.avatarUrl,
        }}
      />
    </div>
  )
}
