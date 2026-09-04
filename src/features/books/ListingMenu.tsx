'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { deleteListingAction, setCopyVisibilityAction } from './actions'
import styles from './ListingMenu.module.css'

/**
 * The owner's controls for one listing, behind a three-dot button.
 *
 * "Hide" used to be the only thing here, sitting in the open as a bare word
 * whose effect was hard to guess. Editing and deleting are what people
 * actually want, and putting all three behind one affordance keeps the card
 * quiet until it is asked.
 */
export function ListingMenu({
  copyId,
  status,
}: {
  copyId: string
  status: 'available' | 'reserved' | 'swapped' | 'inactive'
}) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirming(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setConfirming(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // A reserved copy is committed to a swap in flight; nothing here applies to it.
  const canReopen = status === 'swapped' || status === 'inactive'

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Номын үйлдэл"
        onClick={() => {
          setOpen((v) => !v)
          setConfirming(false)
        }}
      >
        <span className={styles.dots} aria-hidden="true">⋯</span>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <Link href={`/books/${copyId}/edit`} className={styles.item} onClick={() => setOpen(false)}>
            Засварлах
          </Link>

          {canReopen && (
            <button
              type="button"
              className={styles.item}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await setCopyVisibilityAction(copyId, 'available')
                  if (!r.ok) setError(r.message ?? 'Алдаа гарлаа.')
                  else setOpen(false)
                })
              }
            >
              Солилцоонд нээх
            </button>
          )}

          {confirming ? (
            <button
              type="button"
              className={styles.confirm}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteListingAction(copyId)
                  if (!r.ok) {
                    setError(r.message ?? 'Устгаж чадсангүй.')
                    setConfirming(false)
                  } else {
                    setOpen(false)
                  }
                })
              }
            >
              {pending ? 'Устгаж байна…' : 'Устгахдаа итгэлтэй байна уу?'}
            </button>
          ) : (
            <button
              type="button"
              className={styles.danger}
              disabled={pending}
              onClick={() => setConfirming(true)}
            >
              Устгах
            </button>
          )}
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
