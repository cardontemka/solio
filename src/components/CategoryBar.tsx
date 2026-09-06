'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { BOOK_CATEGORY, CATEGORY_LABEL } from '@/types/domain'
import styles from './CategoryBar.module.css'

/**
 * A horizontal strip of categories under the header.
 *
 * Each one is a link rather than a button: a filtered shelf is a page worth
 * having a URL, so it can be shared, bookmarked and returned to with the back
 * button. Scrolls sideways instead of wrapping, so the strip never pushes the
 * books further down.
 */
export function CategoryBar() {
  const pathname = usePathname()
  const params = useSearchParams()
  const active = params.get('category')
  const q = params.get('q')

  const hrefFor = (category?: string) => {
    const next = new URLSearchParams()
    if (q) next.set('q', q)
    if (category) next.set('category', category)
    const query = next.toString()
    // Staying on /search keeps any query the reader already typed.
    const base = pathname === '/search' ? '/search' : '/search'
    return query ? `${base}?${query}` : base
  }

  return (
    <nav className={styles.bar} aria-label="Ангилал">
      <div className={`container ${styles.inner}`}>
        <Link href={hrefFor()} className={styles.chip} data-active={!active}>
          Бүгд
        </Link>
        {BOOK_CATEGORY.map((c) => (
          <Link key={c} href={hrefFor(c)} className={styles.chip} data-active={active === c}>
            {CATEGORY_LABEL[c]}
          </Link>
        ))}
      </div>
    </nav>
  )
}
