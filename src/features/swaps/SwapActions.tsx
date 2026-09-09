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
      // Confirming is an assertion about the physical world, and the person who
      // made it used to be left with no buttons at all — if the other side never
      // answered, or a book in the swap disappeared, the swap could not be
      // finished or abandoned by anyone. Withdrawing your own confirmation is
      // not backing out of somebody else's, so it is offered here.
      if (iConfirmed) {
        return [{ kind: 'cancel', label: 'Баталгаажуулалтаа буцаах' }]
      }
      return blocked
        ? // Nothing left to hand over, so the only useful move is to close it.
          [{ kind: 'cancel', label: 'Цуцлах', primary: true }]
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
          Энэ солилцоон дахь ном өөрчлөгдсөн байна — өмчлөгч нь солигдсон, өөр солилцоонд
          орсон, эсвэл устсан. Дуусгах боломжгүй тул цуцлана уу.
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
