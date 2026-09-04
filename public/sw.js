/* Solio push service worker.
 *
 * Deliberately tiny: it shows what the server sent and opens the page it names.
 * No caching — an offline shell is a separate decision, and a service worker
 * that silently serves stale pages is worse than none.
 */
self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Solio', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Solio', {
      body: payload.body || '',
      icon: '/logo.png',
      badge: '/logo.png',
      // Same tag replaces an earlier notification about the same thing instead
      // of stacking duplicates.
      tag: payload.tag || 'solio',
      data: { url: payload.url || '/notifications' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/notifications'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Reuse an open tab when there is one; opening a second copy of the site
      // is the usual annoyance here.
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
