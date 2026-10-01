import { CheckCircle2, Clock, XCircle, AlertTriangle, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

type Tone = "verified" | "pending" | "warning" | "danger" | "neutral" | "default";

const TONE_MAP: Record<Tone, { variant: "verified" | "warning" | "destructive" | "neutral" | "secondary"; icon: LucideIcon }> = {
  verified: { variant: "verified", icon: CheckCircle2 },
  pending: { variant: "warning", icon: Clock },
  warning: { variant: "warning", icon: AlertTriangle },
  danger: { variant: "destructive", icon: XCircle },
  neutral: { variant: "neutral", icon: Clock },
  default: { variant: "neutral", icon: Clock },
};

interface StatusPillProps {
  label: string;
  tone: Tone;
}

/** Small status indicator reused for verification, consent, and account states. */
export function StatusPill({ label, tone }: StatusPillProps) {
  const { variant, icon: Icon } = TONE_MAP[tone];
  return (
    <Badge variant={variant}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}
