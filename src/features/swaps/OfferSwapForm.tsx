'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { requestSwapAction, type SwapActionState } from './actions'
import styles from './OfferSwapForm.module.css'

const initial: SwapActionState = { ok: false }

export type OfferableCopy = { copyId: string; title: string; author: string | null }

/**
 * Pick one of my available books to put on the table against `requestedCopyId`.
 * The action sends two ids and nothing else — the RPC works out ownership.
 */
export function OfferSwapForm({
  requestedCopyId,
  offerable,
}: {
  requestedCopyId: string
  offerable: OfferableCopy[]
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(requestSwapAction, initial)

  if (state.ok) {
    return (
      <p className={styles.sent}>
        ✓ Хүсэлт илгээгдлээ. <Link href="/swaps">Солилцоо хуудаснаас</Link> хянана уу.
      </p>
    )
  }

  if (offerable.length === 0) {
    return (
      <p className={styles.none}>
        Солилцоо санал болгохын тулд эхлээд <Link href="/books/new">өөрийн ном нэмнэ үү</Link>.
      </p>
    )
  }

  if (!open) {
    return (
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)}>
        Солилцоо санал болгох
      </button>
    )
  }

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="requestedCopyId" value={requestedCopyId} />

      <label className={styles.label} htmlFor={`offer-${requestedCopyId}`}>
        Хариуд нь санал болгох ном
      </label>
      <select
        id={`offer-${requestedCopyId}`}
        name="offeredCopyId"
        className={styles.select}
        required
        defaultValue=""
      >
        <option value="" disabled>
          Сонгоно уу…
        </option>
        {offerable.map((c) => (
          <option key={c.copyId} value={c.copyId}>
            {c.title}
            {c.author ? ` — ${c.author}` : ''}
          </option>
        ))}
      </select>

      <label className={styles.label} htmlFor={`msg-${requestedCopyId}`}>
        Мессеж <span className={styles.optional}>заавал биш</span>
      </label>
      <textarea
        id={`msg-${requestedCopyId}`}
        name="message"
        className={styles.textarea}
        maxLength={2000}
        rows={2}
        placeholder="Сайн байна уу? Энэ номыг солилцох уу?"
      />

      {!state.ok && state.message && <p className={styles.error}>{state.message}</p>}

      <div className={styles.row}>
        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? 'Илгээж байна…' : 'Хүсэлт илгээх'}
        </button>
        <button
          type="button"
          className={styles.cancel}
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Болих
        </button>
      </div>
    </form>
  )
}
