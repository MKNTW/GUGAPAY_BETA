self.addEventListener('install', event => {
  console.log('Service Worker installing.');
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('Service Worker activating.');
});

self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});

// ───── Push ─────
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  const title = data.title || 'Новое уведомление';
  const options = {
    body: data.body,
    icon: '/photo/icon-192.png',
    badge: '/photo/icon-192.png',
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data.url;
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(list =>
      list[0] ? list[0].focus() : clients.openWindow(url)
    )
  );
});
