import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const VAPID_PUBLIC_KEY = "BJEeBhU0l-k0GKc7AuLG8omXjdAmC2g40Fkdh2j9MNVgkiYF2hg5A1nZljSH8qCQtzp8TcQEpvQe1nRSPZDKb_4";

const urlBase64ToUint8Array = (base64: string) => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

type State = "unsupported" | "default" | "granted" | "denied";

export const usePushNotifications = () => {
  const { user } = useAuth();
  const [state, setState] = useState<State>("default");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    setState(Notification.permission as State);
  }, []);

  const subscribe = useCallback(async () => {
    if (!user) return;
    if (state === "unsupported") return;
    setBusy(true);
    try {
      // In production the PWA service worker (/sw.js) is already registered by registerPwa().
      // In dev / preview there is no SW, so register the lightweight push-only worker as a fallback.
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register("/push-sw.js");
      }
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      setState(permission as State);
      if (permission !== "granted") return;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const json = sub.toJSON();
      await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
          user_agent: navigator.userAgent,
        },
        { onConflict: "endpoint" }
      );
    } finally {
      setBusy(false);
    }
  }, [user, state]);

  const unsubscribe = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, subscribe, unsubscribe };
};
