'use client'

import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import styles from './SearchBar.module.css'

type Suggestion = {
  copyId: string
  title: string
  author: string | null
  imageUrl: string | null
  ownerName: string | null
}

/**
 * Search with type-ahead.
 *
 * The list only ever contains listings that exist — it comes from the same
 * query the results page runs — because a suggestion that leads nowhere is
 * worse than no suggestion at all. Requests are debounced and the previous one
 * is aborted, so a fast typist makes one round trip, not one per keystroke.
 */
export function SearchBar({
  initialQuery = '',
  size = 'md',
  autoFocus = false,
}: {
  initialQuery?: string
  size?: 'md' | 'lg'
  autoFocus?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const [q, setQ] = useState(initialQuery)
  const [items, setItems] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // Only arrow-key navigation arms Enter; hovering must not choose for anyone.
  const [usedKeys, setUsedKeys] = useState(false)

  // Let go of the field once the page has changed. Tapping a result navigates
  // but leaves the input focused, so the header would stay in its search state
  // — on a phone that means the logo and buttons hidden behind a keyboard with
  // nothing left to type into.
  //
  // Closing is a render-time adjustment rather than an effect: reacting to the
  // new route in an effect commits twice for one render. Blurring stays in an
  // effect because it touches the DOM, not state.
  const navKey = `${pathname}?${params.toString()}`
  const [seenNav, setSeenNav] = useState(navKey)
  if (seenNav !== navKey) {
    setSeenNav(navKey)
    setOpen(false)
  }

  useEffect(() => {
    inputRef.current?.blur()
  }, [navKey])

  useEffect(() => {
    const term = q.trim()
    // Nothing to ask for yet. Stale items are simply not shown — showList
    // checks the term's length — so there is no state to clear here.
    if (term.length < 2) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        })
        const body = await res.json()
        setItems(body.items ?? [])
        setActive(-1)
        setUsedKeys(false)
      } catch {
        // An aborted request is the normal case while typing.
      }
    }, 180)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [q])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function submit(term: string) {
    inputRef.current?.blur()
    setOpen(false)
    router.push(term ? `/search?q=${encodeURIComponent(term)}` : '/search')
  }

  function go(item: Suggestion) {
    inputRef.current?.blur()
    setOpen(false)
    router.push(`/books/${item.copyId}`)
  }

  const showList = open && q.trim().length >= 2 && items.length > 0

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <form
        className={styles.form}
        data-size={size}
        data-open={showList}
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          // Enter runs the search. A suggestion is only opened when the reader
          // chose one deliberately — with the arrow keys, or by clicking it.
          // Jumping into the first match on Enter takes the decision away from
          // them and hides the results page they asked for.
          if (usedKeys && active >= 0 && items[active]) go(items[active])
          else submit(q.trim())
        }}
      >
        <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M13.5 13.5 17.5 17.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          className={styles.input}
          type="search"
          name="q"
          value={q}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!showList) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setUsedKeys(true)
              setActive((i) => (i + 1) % items.length)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setUsedKeys(true)
              setActive((i) => (i <= 0 ? items.length - 1 : i - 1))
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          placeholder="Ном бол ертөнцийг харах цонх"
          aria-label="Ном хайх"
        />
        <button type="submit" className={styles.button}>
          Хайх
        </button>
      </form>

      {showList && (
        <ul className={styles.list} id={listId} role="listbox">
          {items.map((item, i) => (
            <li key={item.copyId} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={styles.item}
                data-active={usedKeys && i === active}
                onClick={() => go(item)}
              >
                <span className={styles.thumb}>
                  {item.imageUrl ? (
                    <Image src={item.imageUrl} alt="" width={68} height={90} unoptimized />
                  ) : (
                    <span className={styles.thumbEmpty} aria-hidden="true" />
                  )}
                </span>
                <span className={styles.text}>
                  <span className={styles.title}>{item.title}</span>
                  <span className={styles.meta}>
                    {[item.author, item.ownerName].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className={styles.all} onClick={() => submit(q.trim())}>
              «{q.trim()}» — бүх илэрцийг үзэх
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}
