'use client'

import { useState, useTransition } from 'react'
import {
  moderateEntityAction,
  moderateProfileAction,
  purgeEntityAction,
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
 * Four buttons, and it is worth being precise about which of them touch the
 * content and which only record a decision:
 *
 *   Хянаж эхлэх  — status → reviewing. A note to the other moderators that
 *                  somebody has picked this up. Changes nothing else.
 *   Нуух         — hides the reported content (moderation_status → hidden) and
 *                  closes the report as resolved. Reversible from Контент.
 *   Устгах       — deletes the content: rows gone, photos gone from the bucket,
 *                  report closed. Nothing to undo it with, which is why the
 *                  database allows it only to an admin and why it is styled as
 *                  the dangerous one.
 *   Шийдвэрлэх   — closes the report as handled WITHOUT touching the content.
 *                  For when the answer was a message, a suspension, or the
 *                  content was already dealt with elsewhere.
 *   Хэрэгсэхгүй  — closes it as "no violation found". Also touches nothing.
 *
 * Both closing buttons notify the reporter; neither is a comment on the content
 * itself, which is why hiding and removing are offered here at all — otherwise a
 * moderator had to find the same item again on another page to act on it.
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
      {hideable && (
        <button
          className={styles.btnDanger}
          disabled={pending}
          title="Контентыг бүрмөсөн устгана — буцаах боломжгүй"
          onClick={() => {
            if (!confirm('Энэ контентыг бүрмөсөн устгах уу?\n\nЗураг нь сангаас хамт устана. Буцаах боломжгүй.'))
              return
            // purge_content closes the report itself, in the same transaction as
            // the delete — a report pointing at nothing has nothing left to judge.
            run(() => purgeEntityAction(hideable, entityId, 'Гомдлын дараа устгасан'))
          }}
        >
          Устгах
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
      <button
        className={styles.btnDanger}
        disabled={pending}
        title="Номыг бүрмөсөн устгана — буцаах боломжгүй"
        onClick={() => {
          // A catalogue row can back several people's listings now, so this is
          // worth spelling out: it is not one person's copy that goes.
          if (
            !confirm(
              'Энэ номыг бүрмөсөн устгах уу?\n\n' +
                'Энэ номыг бүртгэсэн БҮХ хэрэглэгчийн жагсаалт, зураг, сэтгэгдэл хамт устана. ' +
                'Буцаах боломжгүй.'
            )
          )
            return
          run(() => purgeEntityAction('book', bookId, 'Дүрэм зөрчсөн'))
        }}
      >
        Устгах
      </button>
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
