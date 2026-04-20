import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Simple accelerometer step counter using DeviceMotion.
 * Detects peaks in acceleration magnitude with a threshold + cooldown.
 * Works in modern mobile browsers. Requires user gesture on iOS to grant permission.
 */
type Status = "idle" | "running" | "paused" | "unsupported" | "denied";

const PEAK_THRESHOLD = 11.5; // m/s^2 — slightly above gravity (~9.8)
const MIN_INTERVAL_MS = 280; // ~210 steps/min max — filters double counts

export const useStepCounter = () => {
  const [steps, setSteps] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const lastPeakAtRef = useRef(0);
  const handlerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);

  const onMotion = useCallback((e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    const now = Date.now();
    if (mag > PEAK_THRESHOLD && now - lastPeakAtRef.current > MIN_INTERVAL_MS) {
      lastPeakAtRef.current = now;
      setSteps((s) => s + 1);
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (typeof DeviceMotionEvent === "undefined") {
      setStatus("unsupported");
      return false;
    }
    // iOS 13+ requires explicit permission
    const anyDM = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof anyDM.requestPermission === "function") {
      try {
        const result = await anyDM.requestPermission();
        if (result !== "granted") {
          setStatus("denied");
          return false;
        }
      } catch {
        setStatus("denied");
        return false;
      }
    }
    return true;
  }, []);

  const start = useCallback(async () => {
    const ok = await requestPermission();
    if (!ok) return false;
    handlerRef.current = onMotion;
    window.addEventListener("devicemotion", handlerRef.current);
    setStatus("running");
    return true;
  }, [onMotion, requestPermission]);

  const pause = useCallback(() => {
    if (handlerRef.current) {
      window.removeEventListener("devicemotion", handlerRef.current);
      handlerRef.current = null;
    }
    setStatus("paused");
  }, []);

  const reset = useCallback(() => {
    if (handlerRef.current) {
      window.removeEventListener("devicemotion", handlerRef.current);
      handlerRef.current = null;
    }
    setSteps(0);
    lastPeakAtRef.current = 0;
    setStatus("idle");
  }, []);

  useEffect(() => {
    return () => {
      if (handlerRef.current) {
        window.removeEventListener("devicemotion", handlerRef.current);
      }
    };
  }, []);

  return { steps, status, start, pause, reset };
};
