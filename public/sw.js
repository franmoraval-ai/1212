const CACHE_NAME = "ho-seguridad-v7-offline";
const APP_SHELL = ["/", "/login", "/overview", "/manifest.webmanifest"];
const DASHBOARD_ROUTES = ["/rounds", "/supervision", "/station", "/incidents/report", "/shift-book", "/map"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Prefetch key dashboard routes after login so they work offline.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PREFETCH_DASHBOARD") {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) =>
        Promise.all(
          DASHBOARD_ROUTES.map((route) =>
            cache.match(route).then((existing) => {
              if (existing) return; // already cached
              return fetch(route, { credentials: "include" })
                .then((response) => {
                  if (response.ok) cache.put(route, response);
                })
                .catch(() => {}); // ignore fetch failures
            })
          )
        )
      )
    );
  }
});

// Background Sync: when connectivity returns, wake any open client so it can
// flush its localStorage-backed offline queues. The queues live in the page
// (localStorage is not accessible from the SW), so the SW only nudges clients.
self.addEventListener("sync", (event) => {
  if (event.tag !== "flush-offline-queue") return;
  event.waitUntil(
    self.clients
      .matchAll({ includeUncontrolled: true, type: "window" })
      .then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "FLUSH_OFFLINE_QUEUE" }));
      })
  );
});

// Web Push: mostrar la notificación entrante enviada por /api/push/*.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { title: "HO Seguridad", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "HO Seguridad";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.tag || "ho-seguridad",
    renotify: Boolean(payload.tag),
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Al tocar la notificación: enfocar una pestaña abierta o abrir la ruta destino.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({ type: "PUSH_NAVIGATE", url: targetUrl });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  const isStaticAsset = ["script", "style", "image", "font"].includes(event.request.destination);
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
