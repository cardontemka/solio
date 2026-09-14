'use client'

import { useState, useTransition } from 'react'
import { releaseStoredAction } from './actions'
import styles from './ReleaseStoredButton.module.css'

/**
 * Shown only to the venue that is holding the thing: it has gone back to its
 * owner and is no longer on our shelf.
 *
 * The owner never sees this. Where a book is, is a fact the keeper reports, not
 * a field the owner edits.
 */
export function ReleaseStoredButton({ copyId }: { copyId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.button}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null)
            const r = await releaseStoredAction(copyId)
            if (!r.ok) setError(r.message ?? 'Болсонгүй.')
          })
        }
      >
        {pending ? 'Бүртгэж байна…' : 'Эзэнд нь буцааж өглөө'}
      </button>
      <p className={styles.note}>
        Энэ зүйл таны тавиур дээр байхаа больсныг бүртгэнэ. Эзэмшил өөрчлөгдөхгүй.
      </p>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
