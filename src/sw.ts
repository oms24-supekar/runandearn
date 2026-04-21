/// <reference lib="webworker" />
/* eslint-disable @typescript-eslint/no-explicit-any */
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { BackgroundSyncPlugin } from "workbox-background-sync";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback (offline shell)
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: "pages",
      networkTimeoutSeconds: 3,
    }),
    {
      denylist: [/^\/~oauth/, /^\/api/, /^\/functions/],
    }
  )
);

// Static assets
registerRoute(
  ({ request }) => ["style", "script", "worker"].includes(request.destination),
  new StaleWhileRevalidate({ cacheName: "assets" })
);

// Images
registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "images",
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  })
);

// Background Sync: queue failed Supabase activity POSTs and replay when back online
const activityQueue = new BackgroundSyncPlugin("activity-queue", {
  maxRetentionTime: 24 * 60, // retry for 24h
});

registerRoute(
  ({ url, request }) =>
    request.method === "POST" &&
    url.hostname.endsWith(".supabase.co") &&
    url.pathname.includes("/rest/v1/activities"),
  new NetworkFirst({
    cacheName: "activity-posts",
    plugins: [activityQueue],
  }),
  "POST"
);

// ---- Push notifications (merged from old push-sw.js) ----
self.addEventListener("push", (event: PushEvent) => {
  let data: { title: string; body: string; url: string } = {
    title: "RUN & EARN",
    body: "You have a new notification",
    url: "/",
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as any)?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          (client as WindowClient).navigate(url);
          return (client as WindowClient).focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

export {};
