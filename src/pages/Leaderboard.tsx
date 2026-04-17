import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Medal, Award } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const Leaderboard = () => {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: leaders, isLoading } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, total_points, total_distance_km")
        .order("total_points", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // Realtime updates
  useEffect(() => {
    const channel = supabase
      .channel("leaderboard-profiles")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        () => qc.invalidateQueries({ queryKey: ["leaderboard"] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const rankIcon = (rank: number) => {
    if (rank === 0) return <Trophy className="h-5 w-5 text-accent" />;
    if (rank === 1) return <Medal className="h-5 w-5 text-muted-foreground" />;
    if (rank === 2) return <Award className="h-5 w-5 text-primary" />;
    return <span className="w-5 text-center text-sm font-semibold text-muted-foreground">{rank + 1}</span>;
  };

  return (
    <div className="space-y-5 p-4">
      <header className="pt-2">
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <p className="text-sm text-muted-foreground">Top earners — updates in real time</p>
      </header>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="h-16 animate-pulse bg-muted" />
          ))}
        </div>
      ) : leaders && leaders.length > 0 ? (
        <div className="space-y-2">
          {leaders.map((p, i) => {
            const isMe = p.id === user?.id;
            return (
              <Card
                key={p.id}
                className={cn(
                  "flex items-center gap-3 p-3 shadow-card",
                  isMe && "border-primary bg-primary/5"
                )}
              >
                <div className="flex w-7 justify-center">{rankIcon(i)}</div>
                <Avatar className="h-10 w-10">
                  <AvatarImage src={p.avatar_url ?? undefined} />
                  <AvatarFallback>{(p.display_name ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {p.display_name ?? "Runner"} {isMe && <span className="text-xs text-primary">(you)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{Number(p.total_distance_km).toFixed(1)} km</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-accent">{p.total_points}</p>
                  <p className="text-xs text-muted-foreground">pts</p>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-6 text-center shadow-card">
          <Trophy className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">No runners yet. Be the first!</p>
        </Card>
      )}
    </div>
  );
};

export default Leaderboard;
