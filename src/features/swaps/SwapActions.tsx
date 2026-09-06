'use client'

import { useState, useTransition } from 'react'
import {
  acceptSwapAction,
  cancelSwapAction,
  completeSwapAction,
  rejectSwapAction,
  type SwapActionState,
} from './actions'
import type { SwapStatus } from '@/types/domain'
import styles from './SwapsPanel.module.css'

type Kind = 'accept' | 'reject' | 'cancel' | 'confirm'

const RUN: Record<Kind, (id: string) => Promise<SwapActionState>> = {
  accept: acceptSwapAction,
  reject: rejectSwapAction,
  cancel: cancelSwapAction,
  confirm: completeSwapAction,
}

/**
 * Which buttons exist mirrors docs/transactions.md §2.1 — but only for UX.
 * The database refuses anything this list gets wrong, so a stale page cannot
 * drive an illegal transition.
 */
function buttonsFor(
  status: SwapStatus,
  direction: 'incoming' | 'outgoing',
  iConfirmed: boolean
): { kind: Kind; label: string; primary?: boolean }[] {
  switch (status) {
    case 'REQUESTED':
      return direction === 'incoming'
        ? [
            { kind: 'accept', label: 'Хүлээн авах', primary: true },
            { kind: 'reject', label: 'Татгалзах' },
          ]
        : [{ kind: 'cancel', label: 'Цуцлах' }]
    case 'ACCEPTED':
      return [
        { kind: 'confirm', label: 'Биечлэн авсныг баталгаажуулах', primary: true },
        { kind: 'cancel', label: 'Цуцлах' },
      ]
    case 'CONFIRMED':
      return iConfirmed
        ? []
        : [{ kind: 'confirm', label: 'Хүлээн авсныг баталгаажуулах', primary: true }]
    default:
      return []
  }
}

export function SwapActions({
  swapId,
  status,
  direction,
  iConfirmed,
}: {
  swapId: string
  status: SwapStatus
  direction: 'incoming' | 'outgoing'
  iConfirmed: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const buttons = buttonsFor(status, direction, iConfirmed)

  if (buttons.length === 0 && !error) return null

  return (
    <div className={styles.actions}>
      {buttons.map((b) => (
        <button
          key={b.kind}
          type="button"
          className={b.primary ? styles.primary : styles.secondary}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null)
              const result = await RUN[b.kind](swapId)
              if (!result.ok) setError(result.message ?? 'Алдаа гарлаа.')
            })
          }
        >
          {pending ? '…' : b.label}
        </button>
      ))}
      {error && <p className={styles.actionError}>{error}</p>}
    </div>
  )
}
