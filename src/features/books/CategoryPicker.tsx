'use client'

import { useState } from 'react'
import { BOOK_CATEGORY_MAX, CATEGORIES_FOR, CATEGORY_LABEL } from '@/types/domain'
import type { BookCategory, ItemKind } from '@/types/domain'
import styles from './CategoryPicker.module.css'

/**
 * Several headings for one book. A history of Mongolian art is both, and one
 * slot forced a choice that made the filter worse for everyone.
 *
 * Checkboxes rather than a multiple <select>: a native multi-select needs a
 * modifier key nobody discovers, and on a phone it is a scroll trap. These are
 * real checkboxes styled as chips, so they submit as repeated `categories`
 * fields with no JavaScript in the path — the form still works if the picker
 * never hydrates.
 *
 * Thirty-one headings is more than fits comfortably, so the list starts folded
 * to the ones in use plus a first screenful. Records get their own, shorter
 * list — genres, not shelves — from the same set of database values.
 */
export function CategoryPicker({
  name = 'categories',
  initial = [],
  disabled = false,
  kind = 'book',
}: {
  name?: string
  initial?: BookCategory[]
  disabled?: boolean
  kind?: ItemKind
}) {
  const all = CATEGORIES_FOR[kind] as readonly BookCategory[]
  const [chosen, setChosen] = useState<BookCategory[]>(initial)
  const [expanded, setExpanded] = useState(false)

  const full = chosen.length >= BOOK_CATEGORY_MAX
  // Whatever is already ticked stays visible when folded, wherever it sits in
  // the list — collapsing a choice out of sight reads as losing it.
  const visible = expanded ? all : all.filter((c, i) => i < 12 || chosen.includes(c))

  function toggle(category: BookCategory) {
    setChosen((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : prev.length >= BOOK_CATEGORY_MAX
          ? prev
          : [...prev, category]
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.chips}>
        {visible.map((c) => {
          const on = chosen.includes(c)
          return (
            <label key={c} className={styles.chip} data-on={on} data-full={!on && full}>
              <input
                type="checkbox"
                name={name}
                value={c}
                checked={on}
                disabled={disabled || (!on && full)}
                onChange={() => toggle(c)}
              />
              <span>{CATEGORY_LABEL[c]}</span>
            </label>
          )
        })}
      </div>

      {all.length > visible.length || expanded ? (
        <button
          type="button"
          className={styles.more}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Хураах' : `Бүх ангилал (${all.length})`}
        </button>
      ) : null}

      <span className={styles.count} aria-live="polite">
        {chosen.length === 0
          ? `Хамгийн ихдээ ${BOOK_CATEGORY_MAX}-ыг сонгож болно.`
          : full
            ? `${chosen.length}/${BOOK_CATEGORY_MAX} — хязгаарт хүрсэн.`
            : `${chosen.length}/${BOOK_CATEGORY_MAX} сонгосон.`}
      </span>
    </div>
  )
}
