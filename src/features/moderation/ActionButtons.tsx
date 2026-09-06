'use client'

import { useState, useTransition } from 'react'
import {
  moderateEntityAction,
  moderateProfileAction,
  resolveReportAction,
  setRoleAction,
  type ModState,
} from './actions'
import styles from './ActionButtons.module.css'

function useAction() {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const run = (fn: () => Promise<ModState>) =>
    start(async () => {
      setError(null)
      const r = await fn()
      if (!r.ok) setError(r.message ?? 'Алдаа гарлаа.')
    })
  return { pending, error, run }
}

function Row({
  pending,
  error,
  children,
}: {
  pending: boolean
  error: string | null
  children: React.ReactNode
}) {
  return (
    <div className={styles.row} data-pending={pending}>
      {children}
      {error && <span className={styles.error}>{error}</span>}
    </div>
  )
}

/**
 * Resolving a report records a decision — it does not touch the content. That
 * used to mean a moderator had to find the same item again on another page to
 * act on it, so hiding is offered here, next to the thing being judged.
 */
export function ReportActions({
  id,
  status,
  entityType,
  entityId,
}: {
  id: string
  status: string
  entityType: string
  entityId: string
}) {
  const { pending, error, run } = useAction()
  // Narrowed rather than cast: moderate_entity only knows these, and the list
  // here is what decides whether the button is offered at all.
  const HIDEABLE = ['book', 'book_copy', 'comment', 'request'] as const
  type Hideable = (typeof HIDEABLE)[number]
  const hideable = HIDEABLE.find((t) => t === entityType) as Hideable | undefined

  if (status === 'resolved' || status === 'dismissed') {
    return <span className={styles.done}>Шийдвэрлэсэн</span>
  }
  return (
    <Row pending={pending} error={error}>
      {hideable && (
        <button
          className={styles.btn}
          disabled={pending}
          title="Контентыг нуугаад гомдлыг шийдвэрлэсэн болгоно"
          onClick={() =>
            run(async () => {
              const hidden = await moderateEntityAction(hideable, entityId, 'hidden')
              if (!hidden.ok) return hidden
              return resolveReportAction(id, 'resolved', 'Контентыг нуусан')
            })
          }
        >
          Нуух
        </button>
      )}
      {status === 'open' && (
        <button className={styles.btn} disabled={pending}
                onClick={() => run(() => resolveReportAction(id, 'reviewing'))}>
          Хянаж эхлэх
        </button>
      )}
      <button className={styles.btnPrimary} disabled={pending}
              onClick={() => run(() => resolveReportAction(id, 'resolved', 'Арга хэмжээ авсан'))}>
        Шийдвэрлэх
      </button>
      <button className={styles.btn} disabled={pending}
              onClick={() => run(() => resolveReportAction(id, 'dismissed', 'Зөрчил илрээгүй'))}>
        Хэрэгсэхгүй
      </button>
    </Row>
  )
}

export function ContentActions({
  bookId,
  status,
}: {
  bookId: string
  status: 'active' | 'hidden' | 'removed'
}) {
  const { pending, error, run } = useAction()
  return (
    <Row pending={pending} error={error}>
      {status === 'active' ? (
        <button className={styles.btn} disabled={pending}
                onClick={() => run(() => moderateEntityAction('book', bookId, 'hidden', 'Модераторын шийдвэр'))}>
          Нуух
        </button>
      ) : (
        <button className={styles.btn} disabled={pending}
                onClick={() => run(() => moderateEntityAction('book', bookId, 'active'))}>
          Сэргээх
        </button>
      )}
      {status !== 'removed' && (
        <button className={styles.btnDanger} disabled={pending}
                onClick={() => run(() => moderateEntityAction('book', bookId, 'removed', 'Дүрэм зөрчсөн'))}>
          Устгах
        </button>
      )}
    </Row>
  )
}

export function UserActions({
  userId,
  accountStatus,
  roles,
  viewerIsAdmin,
}: {
  userId: string
  accountStatus: 'active' | 'suspended' | 'removed'
  roles: string[]
  viewerIsAdmin: boolean
}) {
  const { pending, error, run } = useAction()
  const isMod = roles.includes('moderator')
  const isAdmin = roles.includes('admin')

  return (
    <Row pending={pending} error={error}>
      {accountStatus === 'active' ? (
        <button className={styles.btn} disabled={pending}
                onClick={() => run(() => moderateProfileAction(userId, 'suspended', 'Дүрэм зөрчсөн'))}>
          Түдгэлзүүлэх
        </button>
      ) : (
        <button className={styles.btn} disabled={pending}
                onClick={() => run(() => moderateProfileAction(userId, 'active'))}>
          Сэргээх
        </button>
      )}

      {/* Role changes are admin-only; the database refuses regardless of what
          is rendered here, so hiding the button is convenience, not security. */}
      {viewerIsAdmin && !isAdmin && (
        <button className={styles.btn} disabled={pending}
                onClick={() => run(() => setRoleAction(userId, 'moderator', !isMod))}>
          {isMod ? 'Модератор эрх хасах' : 'Модератор болгох'}
        </button>
      )}
    </Row>
  )
}
