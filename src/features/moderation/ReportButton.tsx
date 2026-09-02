'use client'

import { useActionState, useState } from 'react'
import { createReportAction, type ModState } from './actions'
import styles from './ReportButton.module.css'

const initial: ModState = { ok: false }

const REASONS = [
  ['inappropriate', 'Зохисгүй агуулга'],
  ['wrong_metadata', 'Буруу мэдээлэл'],
  ['counterfeit', 'Хуурамч ном'],
  ['spam', 'Спам'],
  ['harassment', 'Дарамт'],
  ['other', 'Бусад'],
] as const

/** Anyone signed in can file a report; only staff can act on one. */
export function ReportButton({
  entityType,
  entityId,
}: {
  entityType: 'book' | 'book_copy' | 'review' | 'profile' | 'swap'
  entityId: string
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(createReportAction, initial)

  if (state.ok) return <span className={styles.sent}>✓ Гомдол хүлээн авлаа</span>

  if (!open) {
    return (
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)}>
        Гомдол мэдүүлэх
      </button>
    )
  }

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />

      <label className={styles.label} htmlFor={`reason-${entityId}`}>Шалтгаан</label>
      <select id={`reason-${entityId}`} name="reason" className={styles.select} required defaultValue="">
        <option value="" disabled>Сонгоно уу…</option>
        {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>

      <textarea
        name="detail"
        className={styles.textarea}
        rows={2}
        maxLength={2000}
        placeholder="Нэмэлт тайлбар (заавал биш)"
      />

      {!state.ok && state.message && <p className={styles.error}>{state.message}</p>}

      <div className={styles.row}>
        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? 'Илгээж байна…' : 'Илгээх'}
        </button>
        <button type="button" className={styles.cancel} onClick={() => setOpen(false)} disabled={pending}>
          Болих
        </button>
      </div>
    </form>
  )
}
