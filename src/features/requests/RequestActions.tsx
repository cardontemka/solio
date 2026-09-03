'use client'

import { useTransition } from 'react'
import {
  cancelRequestAction,
  deleteRequestAction,
  fulfillRequestAction,
  reopenRequestAction,
} from './actions'
import styles from './MyRequestsPanel.module.css'

/**
 * The poster's own controls. Nothing here is destructive by accident: deleting
 * is the only irreversible one and it is the last option.
 */
export function RequestActions({
  id,
  status,
}: {
  id: string
  status: 'open' | 'fulfilled' | 'cancelled'
}) {
  const [pending, start] = useTransition()

  return (
    <div className={styles.actions}>
      {status === 'open' && (
        <button
          type="button"
          className={styles.action}
          disabled={pending}
          onClick={() => start(async () => void (await fulfillRequestAction(id)))}
        >
          Олдлоо
        </button>
      )}
      {status !== 'open' && (
        <button
          type="button"
          className={styles.action}
          disabled={pending}
          onClick={() => start(async () => void (await reopenRequestAction(id)))}
        >
          Дахин хайх
        </button>
      )}
      {status !== 'cancelled' && (
        <button
          type="button"
          className={styles.action}
          disabled={pending}
          onClick={() => start(async () => void (await cancelRequestAction(id)))}
        >
          Нуух
        </button>
      )}
      <button
        type="button"
        className={styles.actionDanger}
        disabled={pending}
        onClick={() => start(async () => void (await deleteRequestAction(id)))}
      >
        Устгах
      </button>
    </div>
  )
}
