import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Activity as ActivityIcon, Coins, Flame, MapPin, Play, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/StatCard";

const Dashboard = () => {
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, total_points, total_distance_km")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: recent } = useQuery({
    queryKey: ["recent-activities", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("id, distance_km, duration_seconds, points_earned, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data;
    },
  });

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <div className="space-y-5 p-4">
      <header className="pt-2">
        <p className="text-sm text-muted-foreground">{greeting},</p>
        <h1 className="text-2xl font-bold">{profile?.display_name ?? "Runner"} 👋</h1>
      </header>

      <Card className="overflow-hidden border-0 bg-gradient-primary p-6 text-primary-foreground shadow-elegant">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm opacity-90">Your wallet</p>
            <p className="mt-1 text-4xl font-bold">{profile?.total_points ?? 0}</p>
            <p className="text-sm opacity-90">points</p>
          </div>
          <div className="rounded-full bg-white/20 p-4 backdrop-blur">
            <Coins className="h-8 w-8" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Total distance"
          value={Number(profile?.total_distance_km ?? 0).toFixed(1)}
          unit="km"
          icon={MapPin}
        />
        <StatCard
          label="Activities"
          value={recent?.length ?? 0}
          icon={ActivityIcon}
        />
      </div>

      <Button asChild size="lg" className="h-14 w-full text-base shadow-elegant">
        <Link to="/activity">
          <Play className="mr-2 h-5 w-5 fill-current" />
          Start a run
        </Link>
      </Button>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <Link to="/profile" className="text-sm font-medium text-primary">View all</Link>
        </div>
        {recent && recent.length > 0 ? (
          <div className="space-y-2">
            {recent.map((a) => (
              <Card key={a.id} className="flex items-center gap-3 p-3 shadow-card">
                <div className="rounded-full bg-primary/10 p-2 text-primary">
                  <ActivityIcon className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {Number(a.distance_km).toFixed(2)} km · {Math.round(a.duration_seconds / 60)} min
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 text-xs font-bold text-accent">
                  <Flame className="h-3 w-3" />+{a.points_earned}
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-6 text-center shadow-card">
            <Trophy className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">No runs yet. Start your first one!</p>
          </Card>
        )}
      </section>
    </div>
  );
};

export default Dashboard;
