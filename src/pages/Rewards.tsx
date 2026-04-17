import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Gift, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useState } from "react";

const Rewards = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [redeeming, setRedeeming] = useState<string | null>(null);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("total_points").eq("id", user!.id).maybeSingle();
      return data;
    },
  });

  const { data: rewards, isLoading } = useQuery({
    queryKey: ["rewards"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rewards")
        .select("*")
        .eq("active", true)
        .order("cost_points", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const balance = profile?.total_points ?? 0;

  const handleRedeem = async (rewardId: string, cost: number, title: string) => {
    if (!user) return;
    if (balance < cost) {
      toast.error("Not enough points");
      return;
    }
    setRedeeming(rewardId);

    const { error: txErr } = await supabase.from("transactions").insert({
      user_id: user.id,
      type: "redeem",
      points: cost,
      reward_id: rewardId,
      note: `Redeemed: ${title}`,
    });

    if (txErr) {
      setRedeeming(null);
      toast.error("Redemption failed");
      return;
    }

    await supabase
      .from("profiles")
      .update({ total_points: balance - cost })
      .eq("id", user.id);

    setRedeeming(null);
    toast.success(`Redeemed ${title}!`);
    qc.invalidateQueries({ queryKey: ["profile"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
  };

  return (
    <div className="space-y-5 p-4">
      <header className="pt-2">
        <h1 className="text-2xl font-bold">Rewards</h1>
        <p className="text-sm text-muted-foreground">Spend your points on real perks</p>
      </header>

      <Card className="flex items-center justify-between border-0 bg-gradient-accent p-4 text-accent-foreground shadow-elegant">
        <div>
          <p className="text-xs opacity-90">Available balance</p>
          <p className="text-3xl font-bold">{balance}</p>
        </div>
        <Coins className="h-8 w-8 opacity-90" />
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rewards?.map((r) => {
            const affordable = balance >= r.cost_points;
            return (
              <Card key={r.id} className="flex flex-col p-4 shadow-card">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-primary/10 p-3 text-primary">
                    <Gift className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold leading-tight">{r.title}</h3>
                    {r.category && <Badge variant="secondary" className="mt-1 text-xs">{r.category}</Badge>}
                  </div>
                </div>
                {r.description && (
                  <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{r.description}</p>
                )}
                <div className="mt-4 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-base font-bold text-accent">
                    <Coins className="h-4 w-4" /> {r.cost_points}
                  </span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" disabled={!affordable || redeeming === r.id}>
                        {affordable ? "Redeem" : "Not enough"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Redeem {r.title}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will deduct <strong>{r.cost_points} points</strong> from your wallet. You'll have{" "}
                          <strong>{balance - r.cost_points} points</strong> left.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleRedeem(r.id, r.cost_points, r.title)}>
                          Confirm
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Rewards;
