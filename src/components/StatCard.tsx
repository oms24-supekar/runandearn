import { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string | number;
  unit?: string;
  icon?: LucideIcon;
  variant?: "default" | "primary" | "accent";
  className?: string;
};

export const StatCard = ({ label, value, unit, icon: Icon, variant = "default", className }: Props) => {
  const variantClasses = {
    default: "bg-card",
    primary: "bg-gradient-primary text-primary-foreground border-0 shadow-elegant",
    accent: "bg-gradient-accent text-accent-foreground border-0 shadow-elegant",
  };

  return (
    <Card className={cn("p-4 shadow-card", variantClasses[variant], className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("text-xs font-medium opacity-80", variant === "default" && "text-muted-foreground")}>
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold leading-tight">
            {value}
            {unit && <span className="ml-1 text-sm font-medium opacity-80">{unit}</span>}
          </p>
        </div>
        {Icon && (
          <div className={cn("rounded-full p-2", variant === "default" ? "bg-primary/10 text-primary" : "bg-white/20")}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
    </Card>
  );
};
