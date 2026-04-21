// Safe PWA registration: never runs in Lovable preview / iframes / dev.
export const registerPwa = () => {
  if (typeof window === "undefined") return;
  if (import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator)) return;

  const isInIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host.includes("lovable.app") && host.startsWith("id-preview");

  if (isInIframe || isPreviewHost) {
    // Clean up any stale SWs in preview contexts
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
    return;
  }

  // Register the generated PWA service worker (replaces old push-sw.js)
  import("workbox-window")
    .then(({ Workbox }) => {
      const wb = new Workbox("/sw.js");
      wb.addEventListener("waiting", () => {
        wb.messageSkipWaiting();
      });
      wb.register().catch((err) => console.warn("[PWA] register failed", err));
    })
    .catch(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
};
