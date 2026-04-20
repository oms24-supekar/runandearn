import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Pause, Square, MapPin, Timer, Flame, Coins, Footprints, Signal, SignalLow, SignalMedium, SignalHigh } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/StatCard";
import { useStepCounter } from "@/hooks/useStepCounter";
import { toast } from "sonner";

const POINTS_PER_KM = 10;

type Coord = { lat: number; lng: number; t: number; acc: number };

const haversineKm = (a: Coord, b: Coord) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
};

const formatTime = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

const ActivityTracker = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const stepCounter = useStepCounter();

  const [status, setStatus] = useState<"idle" | "running" | "paused">("idle");
  const [distanceKm, setDistanceKm] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [coords, setCoords] = useState<Coord[]>([]);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<Date | null>(null);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  const startTimer = () => {
    if (timerRef.current) return;
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startGps = () => {
    if (!("geolocation" in navigator)) {
      toast.error("GPS not supported on this device");
      return false;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy ?? 999;
        setAccuracy(acc);
        // Skip points with bad accuracy (>30m)
        if (acc > 30) return;
        const next: Coord = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          t: Date.now(),
          acc,
        };
        setCoords((prev) => {
          const last = prev[prev.length - 1];
          if (last) {
            const d = haversineKm(last, next);
            const dt = (next.t - last.t) / 1000;
            // Ignore jitter < 5m and unrealistic >12m/s (~43km/h)
            if (d > 0.005 && d / Math.max(dt, 0.1) < 0.012) {
              setDistanceKm((cur) => cur + d);
            }
          }
          return [...prev, next];
        });
      },
      (err) => {
        toast.error(err.code === 1 ? "Location permission denied" : "GPS error");
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
    return true;
  };

  const stopGps = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  const handleStart = async () => {
    if (!startGps()) return;
    await stepCounter.start(); // ok if denied; steps just stay 0
    startTimeRef.current = new Date();
    setStatus("running");
    startTimer();
  };

  const handlePause = () => {
    setStatus("paused");
    stopTimer();
    stopGps();
    stepCounter.pause();
  };

  const handleResume = async () => {
    if (!startGps()) return;
    await stepCounter.start();
    setStatus("running");
    startTimer();
  };

  const handleStop = async () => {
    stopTimer();
    stopGps();
    stepCounter.pause();
    if (!user || !startTimeRef.current) return;
    if (distanceKm < 0.01) {
      toast.info("Run too short to save");
      reset();
      return;
    }

    setSaving(true);
    const points = Math.floor(distanceKm * POINTS_PER_KM);
    const calories = Math.round(distanceKm * 60);
    const pace = distanceKm > 0 ? seconds / 60 / distanceKm : null;
    const endTime = new Date();

    const { data: activity, error: actErr } = await supabase
      .from("activities")
      .insert({
        user_id: user.id,
        start_time: startTimeRef.current.toISOString(),
        end_time: endTime.toISOString(),
        distance_km: Number(distanceKm.toFixed(3)),
        duration_seconds: seconds,
        avg_pace_min_per_km: pace ? Number(pace.toFixed(2)) : null,
        calories,
        steps: stepCounter.steps,
        points_earned: points,
        route_geojson:
          coords.length > 0
            ? { type: "LineString", coordinates: coords.map((c) => [c.lng, c.lat]) }
            : null,
      })
      .select()
      .single();

    if (actErr || !activity) {
      setSaving(false);
      toast.error("Failed to save run");
      return;
    }

    let newBalance = 0;
    if (points > 0) {
      await supabase.from("transactions").insert({
        user_id: user.id,
        type: "earn",
        points,
        activity_id: activity.id,
        note: `Earned from ${distanceKm.toFixed(2)} km run`,
      });

      const { data: prof } = await supabase
        .from("profiles")
        .select("total_points, total_distance_km")
        .eq("id", user.id)
        .single();
      if (prof) {
        newBalance = (prof.total_points ?? 0) + points;
        await supabase
          .from("profiles")
          .update({
            total_points: newBalance,
            total_distance_km: Number((Number(prof.total_distance_km ?? 0) + distanceKm).toFixed(2)),
          })
          .eq("id", user.id);
      }
    }

    // Send a push notification (fire-and-forget)
    supabase.functions
      .invoke("send-push", {
        body: {
          title: "Run saved! 🎉",
          body: `+${points} points · ${distanceKm.toFixed(2)} km · ${stepCounter.steps} steps`,
          url: "/profile",
        },
      })
      .catch(() => {});

    toast.success(`Saved! +${points} points earned 🎉`);
    setSaving(false);
    navigate("/");
  };

  const reset = () => {
    setStatus("idle");
    setDistanceKm(0);
    setSeconds(0);
    setCoords([]);
    setAccuracy(null);
    stepCounter.reset();
    startTimeRef.current = null;
  };

  const pace = distanceKm > 0 ? seconds / 60 / distanceKm : 0;
  const projectedPoints = Math.floor(distanceKm * POINTS_PER_KM);

  const SignalIcon = !accuracy
    ? Signal
    : accuracy < 10
    ? SignalHigh
    : accuracy < 20
    ? SignalMedium
    : SignalLow;
  const signalLabel = !accuracy
    ? "Acquiring GPS..."
    : accuracy < 10
    ? "Strong"
    : accuracy < 20
    ? "Good"
    : accuracy < 30
    ? "Weak"
    : "Poor — points filtered";

  return (
    <div className="space-y-5 p-4">
      <header className="pt-2">
        <h1 className="text-2xl font-bold">Activity</h1>
        <p className="text-sm text-muted-foreground">
          {status === "idle" && "Ready when you are"}
          {status === "running" && "Tracking your run..."}
          {status === "paused" && "Paused"}
        </p>
      </header>

      <Card className="border-0 bg-gradient-hero p-8 text-center text-primary-foreground shadow-elegant">
        <p className="text-sm opacity-90">Distance</p>
        <p className="mt-2 text-6xl font-bold tabular-nums">{distanceKm.toFixed(2)}</p>
        <p className="text-sm opacity-90">kilometers</p>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Time" value={formatTime(seconds)} icon={Timer} />
        <StatCard label="Pace" value={pace > 0 ? pace.toFixed(1) : "—"} unit="/km" icon={MapPin} />
        <StatCard label="Steps" value={stepCounter.steps} icon={Footprints} variant="primary" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Points" value={projectedPoints} icon={Coins} variant="accent" />
        <Card className="flex items-center gap-3 p-4 shadow-card">
          <SignalIcon className={`h-5 w-5 ${accuracy && accuracy < 20 ? "text-success" : "text-muted-foreground"}`} />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">GPS signal</p>
            <p className="truncate text-sm font-semibold">
              {signalLabel}
              {accuracy && <span className="ml-1 text-xs text-muted-foreground">±{Math.round(accuracy)}m</span>}
            </p>
          </div>
        </Card>
      </div>

      {stepCounter.status === "denied" && (
        <Card className="p-3 text-xs text-muted-foreground shadow-card">
          Step counter permission denied. Distance + pace will still be tracked.
        </Card>
      )}
      {stepCounter.status === "unsupported" && (
        <Card className="p-3 text-xs text-muted-foreground shadow-card">
          Step counter not supported on this device.
        </Card>
      )}

      <Card className="p-4 shadow-card">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Flame className="h-4 w-4 text-accent" />
          Earn {POINTS_PER_KM} points per km
        </p>
      </Card>

      <div className="flex gap-3">
        {status === "idle" && (
          <Button size="lg" className="h-16 w-full text-base shadow-elegant" onClick={handleStart}>
            <Play className="mr-2 h-5 w-5 fill-current" /> Start
          </Button>
        )}
        {status === "running" && (
          <>
            <Button size="lg" variant="secondary" className="h-16 flex-1" onClick={handlePause}>
              <Pause className="mr-2 h-5 w-5" /> Pause
            </Button>
            <Button size="lg" variant="destructive" className="h-16 flex-1" onClick={handleStop} disabled={saving}>
              <Square className="mr-2 h-5 w-5" /> {saving ? "Saving..." : "Stop"}
            </Button>
          </>
        )}
        {status === "paused" && (
          <>
            <Button size="lg" className="h-16 flex-1" onClick={handleResume}>
              <Play className="mr-2 h-5 w-5 fill-current" /> Resume
            </Button>
            <Button size="lg" variant="destructive" className="h-16 flex-1" onClick={handleStop} disabled={saving}>
              <Square className="mr-2 h-5 w-5" /> {saving ? "Saving..." : "Finish"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default ActivityTracker;
