'use client'

import { useEffect } from 'react'
import { recordInterest } from './record'

/**
 * Records what somebody searched for.
 *
 * A typed query is the plainest thing anybody says about what they want — they
 * were not picking from what this site chose to show them — which makes it worth
 * more than a click both to the reader's own suggestions and to whoever is
 * deciding what this site is short of.
 *
 * Client-side, like ViewSignal and for the same reason: a server render is not a
 * search. The page re-renders on paging and on a filter change, and counting
 * those would report one person's browsing as ten people wanting the same book.
 * record_interest ignores repeats within a minute, so paging through results
 * still counts as the one search it was.
 */
export function SearchSignal({ query }: { query: string }) {
  useEffect(() => {
    recordInterest({ kind: 'search', query })
  }, [query])
  return null
}
