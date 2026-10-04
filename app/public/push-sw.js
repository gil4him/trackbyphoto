// Push-only service worker for the website (family notifications).
//
// Registered under its own scope (/push/) so it never controls a page and
// never caches anything: the app's "new version" check and the self-removing
// sw.js at the root scope are unaffected.
//
// FCM delivers the message as JSON: { notification: { title, body },
// data: {...}, fcmOptions: { link } }. iOS requires that every push shows a
// notification, so one is always shown.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch (e) { /* not JSON: show the default text */ }
  const n = payload.notification || {}
  const data = payload.data || {}
  const link = (payload.fcmOptions && payload.fcmOptions.link) || data.link || '/'
  event.waitUntil(self.registration.showNotification(n.title || '오늘하루', {
    body: n.body || '새 소식이 있어요',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // One notice per photo or reply; a repeat replaces rather than stacks.
    tag: data.reactionId || data.memoId || undefined,
    data: { link },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of windows) {
      if ('focus' in w) return w.focus()
    }
    return self.clients.openWindow(link)
  })())
})
