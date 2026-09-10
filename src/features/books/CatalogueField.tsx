'use client'

import Image from 'next/image'
import { useEffect, useId, useRef, useState } from 'react'
import type { CatalogueMatch } from './queries'
import type { ItemKind } from '@/types/domain'
import formStyles from '@/components/forms.module.css'
import styles from './CatalogueField.module.css'

/**
 * The title box, which also asks "энэ ном биш биз?".
 *
 * Not a search: nothing here navigates anywhere. Typing a title looks for rows
 * somebody has already described, and picking one hands its description to the
 * form so the reader does not retype what the site already knows. Their photos
 * and their copy's condition are never touched — those are about their book, not
 * the work.
 *
 * Matching is on titles alone. The reader is answering "is this the same book?",
 * and testing their half-typed title against a stranger's blurb turns that
 * question into a guess.
 */
export function CatalogueField({
  value,
  onChange,
  onAdopt,
  disabled = false,
  invalid = false,
  kind = 'book',
  placeholder = 'Монголын нууц товчоо',
}: {
  value: string
  onChange: (title: string) => void
  onAdopt: (match: CatalogueMatch) => void
  disabled?: boolean
  invalid?: boolean
  kind?: ItemKind
  placeholder?: string
}) {
  const listId = useId()
  /**
   * Answers are stored with the question they answer. Deciding what to show from
   * that pair is a render-time comparison, so nothing has to be cleared when the
   * text changes — a stale list simply stops matching and stops being shown.
   * (Clearing it from the effect would be a setState inside an effect, which
   * costs an extra render pass and is what react-hooks warns about.)
   */
  const [result, setResult] = useState<{ q: string; items: CatalogueMatch[] }>({
    q: '',
    items: [],
  })
  const [active, setActive] = useState(-1)
  const [usedKeys, setUsedKeys] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  // Set when the field should stop asking: after a pick, and after a deliberate
  // dismissal. Typing again raises the question afresh.
  const [muted, setMuted] = useState(false)

  const query = value.trim()
  const items = result.q === query ? result.items : []
  const open = !muted && query.length >= 2 && items.length > 0

  useEffect(() => {
    if (muted || query.length < 2) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/books/catalogue?q=${encodeURIComponent(query)}&kind=${kind}`,
          { signal: controller.signal }
        )
        const body = (await res.json()) as { items: CatalogueMatch[] }
        setResult({ q: query, items: body.items ?? [] })
        setActive(-1)
        setUsedKeys(false)
      } catch {
        // An aborted or failed lookup is not an error the reader needs to see.
      }
    }, 220)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, muted, kind])

  // Clicking away closes the list without choosing anything.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setMuted(true)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function adopt(match: CatalogueMatch) {
    setMuted(true)
    onAdopt(match)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setUsedKeys(true)
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1
        return (next + items.length) % items.length
      })
      return
    }
    // Enter picks only when a row was reached with the arrows. Otherwise it is
    // the reader submitting the title they typed, and stealing that keystroke to
    // choose somebody else's book would be the worst possible surprise.
    if (e.key === 'Enter' && usedKeys && active >= 0) {
      e.preventDefault()
      adopt(items[active])
      return
    }
    if (e.key === 'Escape') {
      setMuted(true)
    }
  }

  return (
    <div className={styles.box} ref={boxRef}>
      <input
        className={formStyles.input}
        id="title"
        name="title"
        type="text"
        required
        maxLength={300}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        role="combobox"
        onChange={(e) => {
          setMuted(false)
          onChange(e.target.value)
        }}
        onKeyDown={onKeyDown}
      />

      {open && (
        <div className={styles.panel} id={listId}>
          <p className={styles.panelHead}>
            {kind === 'vinyl' ? 'Энэ пянз биш биз?' : 'Энэ ном биш биз?'}
          </p>
          <ul className={styles.list} role="listbox">
            {items.map((m, i) => (
              <li key={m.bookId} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={styles.row}
                  data-active={i === active}
                  onClick={() => adopt(m)}
                >
                  <span className={styles.cover}>
                    {m.coverUrl ? (
                      <Image src={m.coverUrl} alt="" width={34} height={48} unoptimized />
                    ) : null}
                  </span>
                  <span className={styles.rowBody}>
                    <span className={styles.rowTitle}>{m.title}</span>
                    <span className={styles.rowMeta}>
                      {m.author ?? 'Зохиогч бичигдээгүй'}
                      {m.publishedYear ? ` · ${m.publishedYear}` : ''}
                      {m.copyCount > 0 ? ` · ${m.copyCount} хүн бүртгэсэн` : ''}
                    </span>
                  </span>
                  <span className={styles.rowPick}>Мэдээллийг авах</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={styles.dismiss} onClick={() => setMuted(true)}>
            Аль нь ч биш — өөрөө бичнэ
          </button>
        </div>
      )}
    </div>
  )
}
