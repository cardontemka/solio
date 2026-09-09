import { EmptyState, PageHeader } from '@/components/ui'
import { Pager } from '@/components/Pager'
import { NotificationList } from '@/features/notifications/NotificationList'
import { PushToggle } from '@/features/notifications/PushToggle'
import { getNotifications, getUnreadCount } from '@/features/notifications/queries'
import { requireUser } from '@/lib/auth/dal'
import { pageFrom, splitPage } from '@/lib/paging'

export const metadata = {
  title: 'Мэдэгдэл',
  robots: { index: false, follow: false },
}

const PER_PAGE = 30

export default async function NotificationsPage({ searchParams }: PageProps<'/notifications'>) {
  await requireUser()
  const params = await searchParams
  const info = pageFrom(params, PER_PAGE)
  const [rows, unread] = await Promise.all([
    getNotifications({ limit: info.fetch, offset: info.offset }),
    getUnreadCount(),
  ])
  const { items: notifications, hasMore } = splitPage(rows, info)

  return (
    <div className="container">
      <PageHeader
        title="Мэдэгдэл"
        subtitle="Солилцоо, сэтгэгдэл болон модерацийн мэдэгдлүүд."
      />

      <PushToggle publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />

      {notifications.length === 0 ? (
        <EmptyState
          title="Мэдэгдэл байхгүй"
          description="Солилцооны хүсэлт ирэх, хүлээн авагдах үед энд харагдана."
        />
      ) : (
        <NotificationList notifications={notifications} unreadCount={unread} />
      )}
      <Pager page={info.page} hasMore={hasMore} params={params} basePath="/notifications" />
    </div>
  )
}
