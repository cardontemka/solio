'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import styles from './NavProgress.module.css'

/**
 * A thin bar under the header while a page change is in flight.
 *
 * This replaces app/loading.tsx, which did the same job with a skeleton — and
 * broke the site while doing it. loading.tsx wraps the page in a Suspense
 * boundary, and when the server flushes the shell before the page's data is
 * ready, the content that streams in afterwards is never hydrated: the HTML
 * arrives and is swapped into place, but React never claims it, so every button
 * and field on the page is dead until the reader navigates again. It reproduces
 * on a bare page with a bare loading.tsx, on Next 16.3.3 and 16.3.4, in both dev
 * and a production build, and it hits whichever pages happen to be slow — which
 * on a warm server is all of them. Without the boundary the server waits for the
 * page and sends it in one piece, and everything hydrates.
 *
 * So the feedback moves to the client, where a navigation is something the
 * router already knows about and no boundary is needed. A hard load has the
 * browser's own spinner; this covers the in-app case, which is the one that
 * looked frozen.
 */
export function NavProgress() {
  const pathname = usePathname()
  const [pending, setPending] = useState(false)
  const [arrived, setArrived] = useState(pathname)

  // The pathname settling is what "arrived" means, so the bar clears itself
  // without anyone having to say so. Read during render rather than in an
  // effect: an effect would commit one frame with the bar still up.
  if (arrived !== pathname) {
    setArrived(pathname)
    setPending(false)
  }

  // A click that never becomes a navigation — something else cancelled it, or
  // the route failed — would otherwise leave the bar running forever.
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => setPending(false), 10000)
    return () => clearTimeout(timer)
  }, [pending])

  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Anything the browser handles itself — a new tab, a download, another
      // site — is not a navigation this bar is about.
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const link = (event.target as Element | null)?.closest?.('a')
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return

      const href = link.getAttribute('href')
      if (!href || href.startsWith('#')) return

      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return

      setPending(true)
    }

    // Capture, not bubble: next/link calls preventDefault() on its own handler
    // to take the navigation client-side, and a listener running after that sees
    // a cancelled event and concludes nothing is happening.
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  // Back and forward take the same amount of waiting and deserve the same bar.
  // The pathname check is what keeps a jump to an anchor on this page quiet:
  // Next's router patches pushState and this fires for those too, and waiting
  // for nothing is exactly what the bar should not advertise. Re-registered per
  // pathname so the comparison is never against a stale one.
  useEffect(() => {
    function onPopState() {
      if (window.location.pathname !== pathname) setPending(true)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [pathname])

  if (!pending) return null
  return <div className={styles.bar} role="presentation" />
}
