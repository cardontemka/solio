'use client'

import { useState, useTransition } from 'react'
import { setCopyVisibilityAction } from './actions'
import styles from './ListingMenu.module.css'

/** Puts a finished or withdrawn listing back on offer. */
export function ReopenListingButton({ copyId }: { copyId: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <button
        type="button"
        className={styles.reopen}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setCopyVisibilityAction(copyId, 'available')
            setError(r.ok ? null : (r.message ?? 'Алдаа гарлаа.'))
          })
        }
      >
        {pending ? 'Нээж байна…' : 'Солилцоонд нээх'}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </>
  )
}
