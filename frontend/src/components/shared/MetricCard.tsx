import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "default" | "verified" | "warning";
  hint?: string;
}

const TONE_CLASSES: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "bg-primary-50 text-primary-700",
  verified: "bg-verified-bg text-verified-foreground",
  warning: "bg-warning-bg text-warning-foreground",
};

/** Compact stat card used across all three dashboards. */
export function MetricCard({ label, value, icon: Icon, tone = "default", hint }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-md", TONE_CLASSES[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
