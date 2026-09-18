'use client'

/**
 * Tell the server what was clicked, without getting in the way of the click.
 *
 * keepalive, so the request survives the navigation that the same click starts —
 * without it the browser cancels an in-flight fetch as soon as the page begins
 * to unload, and the category you clicked would be the one thing never recorded.
 * Failures are swallowed: this is a preference signal, and nothing on any page
 * is waiting for it.
 */
export function recordInterest(
  body:
    | { kind: 'category_click'; category: string }
    | { kind: 'item_view'; copyId: string }
    | { kind: 'search'; query: string }
): void {
  try {
    void fetch('/api/interest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // An older browser without keepalive, or a blocked request. Nothing breaks.
  }
}
