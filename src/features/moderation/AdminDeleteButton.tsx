'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { purgeEntityAction } from './actions'
import styles from './AdminDeleteButton.module.css'

/**
 * An admin's way to remove something from the page it is on.
 *
 * The admin area can already do this, but finding a listing there means
 * knowing its id — and the moment you want a thing gone is the moment you are
 * looking at it. Unlike the owner's delete, this one goes through
 * admin_delete_listing, which cancels any swap the item is caught in first: a
 * slur in a title does not wait for a handover to finish.
 *
 * Two presses, and the second one says what it is about to do. No modal: a
 * confirmation dialog that can be dismissed by accident is not a safer thing
 * than a button that has to be pressed twice.
 */
export function AdminDeleteButton({ copyId, title }: { copyId: string; title: string }) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={armed ? styles.confirm : styles.button}
        disabled={pending}
        onClick={() => {
          if (!armed) {
            setArmed(true)
            return
          }
          start(async () => {
            setError(null)
            const r = await purgeEntityAction('book_copy', copyId, 'Админ устгасан')
            if (!r.ok) {
              setError(r.message ?? 'Устгаж чадсангүй.')
              setArmed(false)
            } else {
              router.push('/')
            }
          })
        }}
      >
        {pending
          ? 'Устгаж байна…'
          : armed
            ? `«${title}»-ийг бүрмөсөн устгах уу?`
            : 'Админ: устгах'}
      </button>
      {armed && !pending && (
        <button type="button" className={styles.cancel} onClick={() => setArmed(false)}>
          Болих
        </button>
      )}
      {error && <span className={styles.error}>{error}</span>}
    </span>
  )
}
