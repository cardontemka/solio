'use client'

import { useEffect } from 'react'
import { recordInterest } from './record'

/**
 * Records that this listing was opened.
 *
 * A client effect rather than a line in the server component: a server render is
 * not a view — Next re-renders on navigation, on revalidation and for the
 * router's own purposes — and a page that writes to the database every time it
 * renders is a page whose recommendations are made of its own traffic.
 *
 * Renders nothing. record_interest ignores repeats within a minute, so React's
 * development double-effect and a reader hitting refresh both count once.
 */
export function ViewSignal({ copyId }: { copyId: string }) {
  useEffect(() => {
    recordInterest({ kind: 'item_view', copyId })
  }, [copyId])
  return null
}
