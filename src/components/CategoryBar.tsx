'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { orderCategories, type CategoryStanding } from '@/features/discovery/order'
import { recordInterest } from '@/features/discovery/record'
import {
  BOOK_CATEGORY,
  CATEGORIES_FOR,
  CATEGORY_LABEL,
  ITEM_KIND,
  KIND_COPY,
  type ItemKind,
} from '@/types/domain'
import styles from './CategoryBar.module.css'

/**
 * A horizontal strip of categories under the header, with the kind in front of
 * them.
 *
 * Each one is a link rather than a button: a filtered shelf is a page worth
 * having a URL, so it can be shared, bookmarked and returned to with the back
 * button. Scrolls sideways instead of wrapping, so the strip never pushes the
 * shelves further down.
 *
 * The categories shown follow the kind. Music genres beside "Сурах бичиг" would
 * be a list of forty headings, most of which return nothing whichever one you
 * pick; picking Пянз first narrows both the strip and the results.
 *
 * Their order is the reader's, not the alphabet's: `standing` comes from what
 * they list, what they take and what they click, and for somebody signed out —
 * or newly signed up, who is the same thing until they do something — it is
 * simply which headings have the most books under them.
 *
 * Headings with nothing under them are left out; see orderCategories.
 */
export function CategoryBar({ standing = {} }: { standing?: CategoryStanding }) {
  const params = useSearchParams()
  const active = params.get('category')
  const q = params.get('q')
  const rawKind = params.get('kind')
  const kind = (ITEM_KIND as readonly string[]).includes(rawKind ?? '')
    ? (rawKind as ItemKind)
    : null

  const hrefFor = (next: { kind?: ItemKind | null; category?: string | null }) => {
    const search = new URLSearchParams()
    if (q) search.set('q', q)
    const k = next.kind === undefined ? kind : next.kind
    if (k) search.set('kind', k)
    const c = next.category === undefined ? active : next.category
    if (c) search.set('category', c)
    const query = search.toString()
    return query ? `/search?${query}` : '/search'
  }

  // Switching kind drops a category that belongs to the other one, rather than
  // carrying a filter forward that can only ever return nothing.
  const keepCategory = (k: ItemKind | null) =>
    active && (k === null || (CATEGORIES_FOR[k] as readonly string[]).includes(active))
      ? active
      : null

  const categories = orderCategories(kind ? CATEGORIES_FOR[kind] : BOOK_CATEGORY, standing, active)

  return (
    <nav className={styles.bar} aria-label="Ангилал">
      <div className={`container ${styles.inner}`}>
        <Link
          href={hrefFor({ kind: null, category: keepCategory(null) })}
          className={styles.chip}
          data-active={!kind}
          data-kind="true"
        >
          Бүгд
        </Link>
        {ITEM_KIND.map((k) => (
          <Link
            key={k}
            href={hrefFor({ kind: k, category: keepCategory(k) })}
            className={styles.chip}
            data-active={kind === k}
            data-kind="true"
          >
            {KIND_COPY[k].one}
          </Link>
        ))}

        <span className={styles.divider} aria-hidden="true" />

        <Link
          href={hrefFor({ category: null })}
          className={styles.chip}
          data-active={!active}
        >
          Бүх ангилал
        </Link>
        {categories.map((c) => (
          <Link
            key={c}
            href={hrefFor({ category: c })}
            className={styles.chip}
            data-active={active === c}
            onClick={() => recordInterest({ kind: 'category_click', category: c })}
          >
            {CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL]}
          </Link>
        ))}
      </div>
    </nav>
  )
}
