'use client'

import { useRouter } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'
import { markAllReadAction, markReadAction } from './actions'
import { RelativeTime } from './RelativeTime'
import type { NotificationView } from './queries'
import styles from './NotificationList.module.css'

/**
 * Marks a notification read and follows its link. Optimistic so the dot
 * disappears immediately; the server action is what actually persists it.
 */
export function NotificationList({
  notifications,
  unreadCount,
}: {
  notifications: NotificationView[]
  unreadCount: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [items, markOptimistic] = useOptimistic(
    notifications,
    (state, id: number | 'all') =>
      state.map((n) => (id === 'all' || n.id === id ? { ...n, isRead: true } : n))
  )

  const open = (n: NotificationView) => {
    startTransition(async () => {
      if (!n.isRead) {
        markOptimistic(n.id)
        await markReadAction(n.id)
      }
      if (n.href) router.push(n.href)
    })
  }

  return (
    <>
      {unreadCount > 0 && (
        <div className={styles.toolbar}>
          <span className={styles.unreadLabel}>{unreadCount} уншаагүй</span>
          <button
            type="button"
            className={styles.markAll}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                markOptimistic('all')
                await markAllReadAction()
              })
            }
          >
            Бүгдийг уншсан болгох
          </button>
        </div>
      )}

      <ul className={styles.list}>
        {items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className={styles.item}
              data-unread={!n.isRead}
              onClick={() => open(n)}
            >
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.body}>
                <span className={styles.title}>{n.title}</span>
                {n.body && <span className={styles.text}>{n.body}</span>}
                <span className={styles.time}>
                  <RelativeTime iso={n.createdAt} />
                </span>
              </span>
              {n.href && <span className={styles.chevron} aria-hidden="true">›</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
