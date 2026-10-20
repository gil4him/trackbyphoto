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
  // The number on the home-screen icon: the worker sends how many notices
  // this person hasn't seen yet. Never let it stop the notification itself.
  const badge = Number(data.badge)
  if (Number.isFinite(badge) && self.navigator && 'setAppBadge' in self.navigator) {
    try { (badge > 0 ? self.navigator.setAppBadge(badge) : self.navigator.clearAppBadge()).catch(() => {}) } catch (e) { /* unsupported */ }
  }
  event.waitUntil(self.registration.showNotification(n.title || 'Daylie', {
    body: n.body || '새 소식이 있어요',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // One notice per photo, reply or digest; a repeat replaces rather than stacks.
    tag: data.reactionId || data.memoId || data.digestId || undefined,
    data: { link },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // A link to something inside the app (a photo, a parent's page, a digest)
    // is opened there; a bare '/' just brings the app to the front.
    const url = new URL(link, self.location.origin)
    const deep = url.pathname !== '/' || url.search !== ''
    for (const w of windows) {
      // This worker never controls the app's pages (its scope is /push/), so
      // it can't navigate them: the open app is told what to open instead
      // (App.tsx listens for 'daylie-open').
      if (deep) w.postMessage({ type: 'daylie-open', link: url.pathname + url.search })
      if ('focus' in w) return w.focus()
    }
    return self.clients.openWindow(link)
  })())
})
