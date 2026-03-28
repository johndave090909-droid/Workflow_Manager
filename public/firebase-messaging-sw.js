// Firebase Cloud Messaging service worker
// Handles background push notifications when the app tab is closed or hidden.
// Uses the compat CDN build (required for service workers — no bundler here).

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyAgNSwj4LTeMbuVMTSbFRmbI6eKRYUsRXg',
  authDomain:        'systems-hub.firebaseapp.com',
  projectId:         'systems-hub',
  storageBucket:     'systems-hub.firebasestorage.app',
  messagingSenderId: '513999161843',
  appId:             '1:513999161843:web:5a17f15e77771c341e2a86',
});

const messaging = firebase.messaging();

// Called when a push arrives while the app is in the background or closed
messaging.onBackgroundMessage(payload => {
  const title      = payload.notification?.title || 'New Message';
  const body       = payload.notification?.body  || '';
  const badgeCount = parseInt(payload.data?.badge || '0', 10);

  // Update the app icon badge number (Android Chrome + iOS Safari PWA)
  if (badgeCount > 0 && 'setAppBadge' in self.registration) {
    self.registration.setAppBadge(badgeCount).catch(() => {});
  }

  self.registration.showNotification(title, {
    body,
    icon:  '/PCC_logo.png',
    badge: '/PCC_logo.png',
    data:  payload.data || {},
  });
});

// Tapping the notification opens the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
