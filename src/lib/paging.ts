import 'server-only'

/**
 * Offset paging, shared by every list on the site.
 *
 * Two decisions worth stating.
 *
 * There is no COUNT. Knowing "page 3 of 47" costs a second scan of the whole
 * table on every request, and no page here shows that number. Instead each query
 * asks for one row more than it will render: if the extra row comes back there
 * is a next page, and it is dropped. One query, one answer, no drift between the
 * count and the rows.
 *
 * Offsets rather than keyset cursors. A keyset cursor is the right answer for a
 * feed of millions; at this size an OFFSET is a few hundred rows skipped, it
 * survives being typed into the URL, and it lets somebody link to page 4. If a
 * list ever grows past the point where that is cheap, the queries change and
 * these helpers stay.
 */

export type PageInfo = {
  /** 1-based, for URLs and for reading. */
  page: number
  /** How many rows the page renders. */
  limit: number
  /** Rows to skip. */
  offset: number
  /** Ask the database for this many; the extra one answers "is there more?". */
  fetch: number
}

/** Reads ?page= from already-awaited searchParams. Anything odd reads as page 1. */
export function pageFrom(
  params: Record<string, string | string[] | undefined>,
  perPage: number,
  key = 'page'
): PageInfo {
  const raw = params[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number.parseInt(value ?? '1', 10)
  // A page number beyond a few thousand is a crawler or a typo, and a huge
  // OFFSET is the one way this scheme gets slow. Cap it.
  const page = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 2000) : 1
  return { page, limit: perPage, offset: (page - 1) * perPage, fetch: perPage + 1 }
}

/**
 * Splits the over-fetched rows into what to render and whether more exist.
 * Pass the array exactly as the query returned it.
 */
export function splitPage<T>(rows: T[], info: PageInfo): { items: T[]; hasMore: boolean } {
  const hasMore = rows.length > info.limit
  return { items: hasMore ? rows.slice(0, info.limit) : rows, hasMore }
}
