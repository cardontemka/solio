'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import styles from './SearchBar.module.css'

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
  const [q, setQ] = useState(initialQuery)

  return (
    <form
      className={styles.form}
      data-size={size}
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = q.trim()
        router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search')
      }}
    >
      <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M13.5 13.5 17.5 17.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <input
        className={styles.input}
        type="search"
        name="q"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Номын нэр, зохиогч, ISBN-ээр хайх…"
        aria-label="Ном хайх"
      />
      <button type="submit" className={styles.button}>
        Хайх
      </button>
    </form>
  )
}
