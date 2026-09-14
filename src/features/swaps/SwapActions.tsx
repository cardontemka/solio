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
  iConfirmed: boolean,
  blocked: boolean
): { kind: Kind; label: string; primary?: boolean }[] {
  // Nothing here cancels. An offer is a promise, and the only way out of one is
  // the responder declining it before they accept — or the swap becoming
  // impossible, which is the `blocked` branch below and the sole case where the
  // database still allows it.
  switch (status) {
    case 'REQUESTED':
      if (direction === 'incoming') {
        return [
          { kind: 'accept', label: 'Хүлээн авах', primary: true },
          { kind: 'reject', label: 'Татгалзах' },
        ]
      }
      return blocked ? [{ kind: 'cancel', label: 'Хаах', primary: true }] : []
    case 'ACCEPTED':
      return [
        { kind: 'confirm', label: 'Биечлэн авсныг баталгаажуулах', primary: true },
        ...(blocked ? ([{ kind: 'cancel', label: 'Хаах' }] as const) : []),
      ]
    case 'CONFIRMED':
      // Nothing left to hand over, so the only useful move is to close it.
      if (blocked) return [{ kind: 'cancel', label: 'Хаах', primary: true }]
      // The one who confirmed is waiting on the other; there is nothing for
      // them to press, and no longer anything to withdraw.
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
  blocked = false,
}: {
  swapId: string
  status: SwapStatus
  direction: 'incoming' | 'outgoing'
  iConfirmed: boolean
  blocked?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const buttons = buttonsFor(status, direction, iConfirmed, blocked)

  if (buttons.length === 0 && !error && !blocked) return null

  return (
    <div className={styles.actions}>
      {blocked && status !== 'COMPLETED' && status !== 'CANCELLED' && status !== 'REJECTED' && (
        <p className={styles.actionNote}>
          Энэ солилцоон дахь зүйл өөрчлөгдсөн байна — өмчлөгч нь солигдсон, өөр солилцоонд
          орсон, эсвэл устсан. Дуусгах боломжгүй тул хаана уу.
        </p>
      )}
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
