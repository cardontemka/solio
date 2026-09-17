'use client'

import { useState } from 'react'
import styles from './ListingSummary.module.css'

export type SummaryItem = { label: string; value: string }

/** Rows past this are folded away until asked for. */
const SHOWN = 3

/**
 * What this thing is, listed under its title.
 *
 * Two earlier attempts are worth naming. First a row of coloured pills —
 * "Сайн", "Боломжтой", "Уран зөгнөлт" — which looked like controls and never
 * said what any value was *about*: a reader had to know already that "Сайн"
 * describes condition. Then one long sentence, which said what each part meant
 * but ran them together, so nothing could be found by scanning.
 *
 * This is the plain form of the same facts: one per line, the label beside the
 * value, no frame and no colour of its own. A list is read by jumping down the
 * left edge, which is exactly how somebody checks a condition or a language.
 */
export function ListingSummary({ items }: { items: SummaryItem[] }) {
  const [open, setOpen] = useState(false)
  const rows = items.filter((i) => i.value)
  if (rows.length === 0) return null

  const hidden = rows.length - SHOWN
  const visible = open ? rows : rows.slice(0, SHOWN)

  return (
    <div className={styles.summary}>
      <dl className={styles.list}>
        {visible.map((row) => (
          <div key={row.label} className={styles.row}>
            <dt className={styles.label}>{row.label}</dt>
            <dd className={styles.value}>{row.value}</dd>
          </div>
        ))}
      </dl>

      {hidden > 0 && (
        <button type="button" className={styles.toggle} onClick={() => setOpen((v) => !v)}>
          {open ? 'хураах' : `… бусад ${hidden}`}
        </button>
      )}
    </div>
  )
}
