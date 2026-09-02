'use client'

import { useState, useTransition } from 'react'
import { cancelRequestAction, deleteRequestAction } from './actions'
import styles from '@/app/wishlist/page.module.css'

export function RequestActions({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (fn: (id: string) => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setError(null)
      const r = await fn(id)
      if (!r.ok) setError(r.message ?? 'Алдаа гарлаа.')
    })

  return (
    <div className={styles.rowActions}>
      {status === 'open' && (
        <button type="button" className={styles.ghost} disabled={pending}
                onClick={() => run(cancelRequestAction)}>
          Цуцлах
        </button>
      )}
      <button type="button" className={styles.ghost} disabled={pending}
              onClick={() => run(deleteRequestAction)}>
        Устгах
      </button>
      {error && <span className={styles.rowError}>{error}</span>}
    </div>
  )
}
