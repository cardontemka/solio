import { EmptyState, PageHeader } from '@/components/ui'
import { NotificationList } from '@/features/notifications/NotificationList'
import { PushToggle } from '@/features/notifications/PushToggle'
import { getNotifications, getUnreadCount } from '@/features/notifications/queries'
import { requireUser } from '@/lib/auth/dal'

export const metadata = {
  title: 'Мэдэгдэл',
  robots: { index: false, follow: false },
}

export default async function NotificationsPage() {
  await requireUser()
  const [notifications, unread] = await Promise.all([getNotifications(), getUnreadCount()])

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
    </div>
  )
}
