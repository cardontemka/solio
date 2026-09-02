'use client'

import { useActionState } from 'react'
import { createRequestAction, type WishState } from './actions'
import { HeartIcon } from '@/components/Icons'
import styles from './WishlistButton.module.css'

const initial: WishState = { ok: false }

/**
 * Adds a wishlist entry bound to a known work, so the matcher can notify the
 * user the moment another copy is listed.
 */
export function WishlistButton({
  bookId,
  title,
  author,
  alreadyRequested,
  variant = 'full',
}: {
  bookId: string
  title: string
  author: string | null
  alreadyRequested: boolean
  variant?: 'full' | 'icon'
}) {
  const [state, formAction, pending] = useActionState(createRequestAction, initial)

  if (alreadyRequested || state.ok) {
    return variant === 'icon' ? (
      <span className={styles.iconDone} title="Хүслийн жагсаалтад байна">
        <HeartIcon size={20} />
      </span>
    ) : (
      <span className={styles.done}>✓ Хүслийн жагсаалтад байна</span>
    )
  }

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="bookId" value={bookId} />
      <input type="hidden" name="title" value={title} />
      {author && <input type="hidden" name="author" value={author} />}
      {variant === 'icon' ? (
        <button
          type="submit"
          className={styles.iconBtn}
          aria-label="Хүслийн жагсаалтад нэмэх"
          title="Хүслийн жагсаалтад нэмэх"
          disabled={pending}
        >
          <HeartIcon size={20} />
        </button>
      ) : (
        <button type="submit" className={styles.button} disabled={pending}>
          {pending ? 'Нэмж байна…' : '+ Хүслийн жагсаалтад нэмэх'}
        </button>
      )}
      {!state.ok && state.message && <span className={styles.error}>{state.message}</span>}
    </form>
  )
}
