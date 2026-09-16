'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import {
  acceptSwapAction,
  cancelSwapAction,
  rejectSwapAction,
  type SwapActionState,
} from './actions'
import type { SwapStatus } from '@/types/domain'
import styles from './SwapsPanel.module.css'

type Kind = 'accept' | 'reject' | 'cancel'

const RUN: Record<Kind, (id: string) => Promise<SwapActionState>> = {
  accept: acceptSwapAction,
  reject: rejectSwapAction,
  cancel: cancelSwapAction,
}

/**
 * Which buttons exist mirrors docs/transactions.md §2.1 — but only for UX.
 * The database refuses anything this list gets wrong, so a stale page cannot
 * drive an illegal transition.
 */
function buttonsFor(
  status: SwapStatus,
  direction: 'incoming' | 'outgoing',
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
    case 'CONFIRMED':
      // Receipt is confirmed by scanning the book, not by pressing anything
      // here — see the note rendered below. The only button left is the escape
      // hatch for a swap that can no longer happen.
      return blocked ? [{ kind: 'cancel', label: 'Хаах', primary: true }] : []
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
  const buttons = buttonsFor(status, direction, blocked)
  // Waiting on the other person's scan, with nothing to do but wait.
  const waiting = status === 'CONFIRMED' && iConfirmed
  const scanning = !blocked && (status === 'ACCEPTED' || (status === 'CONFIRMED' && !iConfirmed))

  if (buttons.length === 0 && !error && !blocked && !scanning && !waiting) return null

  return (
    <div className={styles.actions}>
      {blocked && status !== 'COMPLETED' && status !== 'CANCELLED' && status !== 'REJECTED' && (
        <p className={styles.actionNote}>
          Энэ солилцоон дахь зүйл өөрчлөгдсөн байна — өмчлөгч нь солигдсон, өөр солилцоонд
          орсон, эсвэл устсан. Дуусгах боломжгүй тул хаана уу.
        </p>
      )}
      {scanning && (
        <div className={styles.scanPrompt}>
          <p className={styles.scanText}>
            Номоо биечлэн солилцсоны дараа <strong>гартаа авсан зүйлийнхээ шошгыг
            уншуулж</strong> баталгаажуулна. Товч дарж баталгаажуулах боломжгүй — QR нь
            тухайн зүйл үнэхээр таны гарт байгаагийн баталгаа юм.
          </p>
          <Link href="/take" className={styles.scanLink}>
            Шошго уншуулах
          </Link>
        </div>
      )}
      {waiting && (
        <p className={styles.actionNote}>
          Та хүлээн авсанаа баталгаажуулсан. Нөгөө тал нь өөрийн авсан зүйлийнхээ шошгыг
          уншуулахад солилцоо дуусна.
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
