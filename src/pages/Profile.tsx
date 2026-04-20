import { useQuery } from "@tanstack/react-query";
import { LogOut, Activity as ActivityIcon, Coins, ArrowDownCircle, ArrowUpCircle, Bell, BellOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/StatCard";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const Profile = () => {
  const { user, signOut } = useAuth();
  const push = usePushNotifications();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_url, total_points, total_distance_km")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: activities } = useQuery({
    queryKey: ["all-activities", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("activities")
        .select("id, distance_km, duration_seconds, points_earned, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const { data: transactions } = useQuery({
    queryKey: ["transactions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id, type, points, note, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  return (
    <div className="space-y-5 p-4">
      <header className="flex items-center gap-4 pt-2">
        <Avatar className="h-16 w-16">
          <AvatarImage src={profile?.avatar_url ?? undefined} />
          <AvatarFallback className="text-lg">
            {(profile?.display_name ?? user?.email ?? "?").slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{profile?.display_name ?? "Runner"}</h1>
          <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
        </div>
        <Button variant="outline" size="icon" onClick={signOut} aria-label="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Points" value={profile?.total_points ?? 0} icon={Coins} variant="accent" />
        <StatCard
          label="Distance"
          value={Number(profile?.total_distance_km ?? 0).toFixed(1)}
          unit="km"
          icon={ActivityIcon}
          variant="primary"
        />
      </div>

      {push.state !== "unsupported" && (
        <Card className="flex items-center gap-3 p-4 shadow-card">
          <div className="rounded-full bg-primary/10 p-2 text-primary">
            {push.state === "granted" ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Push notifications</p>
            <p className="text-xs text-muted-foreground">
              {push.state === "granted"
                ? "On — get pinged when you earn or redeem"
                : push.state === "denied"
                ? "Blocked in your browser settings"
                : "Get pinged when you earn or redeem"}
            </p>
          </div>
          {push.state === "granted" ? (
            <Button size="sm" variant="outline" onClick={push.unsubscribe} disabled={push.busy}>
              Off
            </Button>
          ) : (
            <Button size="sm" onClick={push.subscribe} disabled={push.busy || push.state === "denied"}>
              Enable
            </Button>
          )}
        </Card>
      )}

      <Tabs defaultValue="activities">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="activities">Activities</TabsTrigger>
          <TabsTrigger value="wallet">Wallet</TabsTrigger>
        </TabsList>

        <TabsContent value="activities" className="space-y-2 pt-3">
          {activities && activities.length > 0 ? (
            activities.map((a) => (
              <Card key={a.id} className="flex items-center gap-3 p-3 shadow-card">
                <div className="rounded-full bg-primary/10 p-2 text-primary">
                  <ActivityIcon className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {Number(a.distance_km).toFixed(2)} km · {Math.round(a.duration_seconds / 60)} min
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                <span className="text-sm font-bold text-accent">+{a.points_earned}</span>
              </Card>
            ))
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No activities yet.</p>
          )}
        </TabsContent>

        <TabsContent value="wallet" className="space-y-2 pt-3">
          {transactions && transactions.length > 0 ? (
            transactions.map((t) => (
              <Card key={t.id} className="flex items-center gap-3 p-3 shadow-card">
                <div
                  className={
                    t.type === "earn"
                      ? "rounded-full bg-success/10 p-2 text-success"
                      : "rounded-full bg-destructive/10 p-2 text-destructive"
                  }
                >
                  {t.type === "earn" ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.note ?? (t.type === "earn" ? "Earned" : "Redeemed")}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(t.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                <span className={t.type === "earn" ? "font-bold text-success" : "font-bold text-destructive"}>
                  {t.type === "earn" ? "+" : "−"}
                  {t.points}
                </span>
              </Card>
            ))
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No transactions yet.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Profile;
