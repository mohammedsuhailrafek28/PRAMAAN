import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface VerificationBadgeProps {
  label: string;
  state: "cross_checked" | "unverified" | "checking";
  className?: string;
}

/** Per-field verification chip used on the Business Verification page. */
export function VerificationBadge({ label, state, className }: VerificationBadgeProps) {
  const config = {
    cross_checked: {
      icon: CheckCircle2,
      classes: "border-verified-border bg-verified-bg text-verified-foreground",
      text: `${label} Cross-checked`,
    },
    unverified: {
      icon: XCircle,
      classes: "border-border bg-surface text-muted-foreground",
      text: `${label} Unverified`,
    },
    checking: {
      icon: Loader2,
      classes: "border-primary-200 bg-primary-50 text-primary-700",
      text: `Verifying ${label}…`,
    },
  }[state];

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium",
        config.classes,
        className
      )}
    >
      <Icon className={cn("h-4 w-4", state === "checking" && "animate-spin")} />
      {config.text}
    </div>
  );
}
