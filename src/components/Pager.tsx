import Link from 'next/link'
import styles from './Pager.module.css'

/**
 * Previous / next for a paged list.
 *
 * Plain links, so a page can be opened in a new tab, linked to, and reached with
 * no JavaScript at all. Every other query parameter on the page is carried
 * through — losing the search term or the category filter when you turn the page
 * is the classic failure of hand-rolled paging.
 *
 * No page count: nothing here knows how many pages there are, on purpose (see
 * lib/paging.ts). "Хуудас 3" is honest; "3 / 47" would cost a second full scan.
 */
export function Pager({
  page,
  hasMore,
  params,
  basePath,
  paramKey = 'page',
}: {
  page: number
  hasMore: boolean
  /** The page's own search params, so filters survive the jump. */
  params?: Record<string, string | string[] | undefined>
  basePath: string
  paramKey?: string
}) {
  if (page === 1 && !hasMore) return null

  const href = (target: number) => {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(params ?? {})) {
      if (key === paramKey || value == null) continue
      for (const v of Array.isArray(value) ? value : [value]) next.append(key, v)
    }
    if (target > 1) next.set(paramKey, String(target))
    const query = next.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  return (
    <nav className={styles.pager} aria-label="Хуудас">
      {page > 1 ? (
        <Link className={styles.link} href={href(page - 1)} rel="prev">
          ← Өмнөх
        </Link>
      ) : (
        <span className={styles.spacer} />
      )}

      <span className={styles.page}>Хуудас {page}</span>

      {hasMore ? (
        <Link className={styles.link} href={href(page + 1)} rel="next">
          Дараах →
        </Link>
      ) : (
        <span className={styles.spacer} />
      )}
    </nav>
  )
}
