'use client'

import { useState, useTransition } from 'react'
import { setCopyVisibilityAction } from './actions'
import styles from '@/app/my-books/page.module.css'

/**
 * Hide / re-list a copy. The button only offers the two owner-legal edges;
 * the database guard is what actually enforces the state machine.
 */
export function CopyVisibilityButton({
  copyId,
  next,
}: {
  copyId: string
  next: 'available' | 'inactive'
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <button
        type="button"
        className={styles.action}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setCopyVisibilityAction(copyId, next)
            setError(result.ok ? null : (result.message ?? 'Алдаа гарлаа.'))
          })
        }
      >
        {pending ? '…' : next === 'inactive' ? 'Нуух' : 'Сэргээх'}
      </button>
      {error && <span className={styles.actionError}>{error}</span>}
    </>
  )
}
