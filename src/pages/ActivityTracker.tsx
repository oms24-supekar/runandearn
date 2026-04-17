import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Pause, Square, MapPin, Timer, Flame, Coins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/StatCard";
import { toast } from "sonner";

// 1 point per 100 m
const POINTS_PER_KM = 10;

type Coord = { lat: number; lng: number; t: number };

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

  const [status, setStatus] = useState<"idle" | "running" | "paused">("idle");
  const [distanceKm, setDistanceKm] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [coords, setCoords] = useState<Coord[]>([]);
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
        const next: Coord = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
        setCoords((prev) => {
          const last = prev[prev.length - 1];
          if (last) {
            const d = haversineKm(last, next);
            // ignore tiny jitter < 5m and unrealistic jumps > 200m/sec
            const dt = (next.t - last.t) / 1000;
            if (d > 0.005 && d / Math.max(dt, 0.1) < 0.2) {
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

  const handleStart = () => {
    if (!startGps()) return;
    startTimeRef.current = new Date();
    setStatus("running");
    startTimer();
  };

  const handlePause = () => {
    setStatus("paused");
    stopTimer();
    stopGps();
  };

  const handleResume = () => {
    if (!startGps()) return;
    setStatus("running");
    startTimer();
  };

  const handleStop = async () => {
    stopTimer();
    stopGps();
    if (!user || !startTimeRef.current) return;
    if (distanceKm < 0.01) {
      // discard tiny runs
      toast.info("Run too short to save");
      reset();
      return;
    }

    setSaving(true);
    const points = Math.floor(distanceKm * POINTS_PER_KM);
    const calories = Math.round(distanceKm * 60); // rough estimate
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
        points_earned: points,
        route_geojson: coords.length > 0 ? {
          type: "LineString",
          coordinates: coords.map((c) => [c.lng, c.lat]),
        } : null,
      })
      .select()
      .single();

    if (actErr || !activity) {
      setSaving(false);
      toast.error("Failed to save run");
      return;
    }

    // Wallet ledger entry
    if (points > 0) {
      await supabase.from("transactions").insert({
        user_id: user.id,
        type: "earn",
        points,
        activity_id: activity.id,
        note: `Earned from ${distanceKm.toFixed(2)} km run`,
      });

      // Update profile totals (read then write since no RPC)
      const { data: prof } = await supabase
        .from("profiles")
        .select("total_points, total_distance_km")
        .eq("id", user.id)
        .single();
      if (prof) {
        await supabase
          .from("profiles")
          .update({
            total_points: (prof.total_points ?? 0) + points,
            total_distance_km: Number((Number(prof.total_distance_km ?? 0) + distanceKm).toFixed(2)),
          })
          .eq("id", user.id);
      }
    }

    toast.success(`Saved! +${points} points earned 🎉`);
    setSaving(false);
    navigate("/");
  };

  const reset = () => {
    setStatus("idle");
    setDistanceKm(0);
    setSeconds(0);
    setCoords([]);
    startTimeRef.current = null;
  };

  const pace = distanceKm > 0 ? seconds / 60 / distanceKm : 0;
  const projectedPoints = Math.floor(distanceKm * POINTS_PER_KM);

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

      {/* Big distance */}
      <Card className="border-0 bg-gradient-hero p-8 text-center text-primary-foreground shadow-elegant">
        <p className="text-sm opacity-90">Distance</p>
        <p className="mt-2 text-6xl font-bold tabular-nums">{distanceKm.toFixed(2)}</p>
        <p className="text-sm opacity-90">kilometers</p>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Time" value={formatTime(seconds)} icon={Timer} />
        <StatCard label="Pace" value={pace > 0 ? pace.toFixed(1) : "—"} unit="/km" icon={MapPin} />
        <StatCard label="Points" value={projectedPoints} icon={Coins} variant="accent" />
      </div>

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
