self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'WindCli', body: event.data.text() };
  }

  const scopeUrl = self.registration.scope;
  const options = {
    body: payload.body || '',
    icon: new URL('logo-256.png', scopeUrl).href,
    badge: new URL('logo-128.png', scopeUrl).href,
    data: payload.data || {},
    tag: payload.data?.tag || `${payload.data?.sessionId || 'global'}:${payload.data?.code || 'default'}`,
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(payload.title || 'WindCli', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const sessionId = event.notification.data?.sessionId;
  const provider = event.notification.data?.provider || null;
  const relativePath = sessionId ? `session/${encodeURIComponent(sessionId)}` : '';
  const targetUrl = new URL(relativePath, self.registration.scope).href;

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
    const scopeOrigin = new URL(self.registration.scope).origin;
    for (const client of clientList) {
      if (new URL(client.url).origin === scopeOrigin) {
        await client.focus();
        client.postMessage({
          type: 'notification:navigate',
          sessionId: sessionId || null,
          provider,
          urlPath: new URL(targetUrl).pathname,
        });
        return;
      }
    }
    return self.clients.openWindow(targetUrl);
  }));
});
