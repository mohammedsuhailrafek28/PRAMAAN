import { AlertTriangle, Ban, CheckCircle2, Circle, Clock, MinusCircle, XCircle, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/lib/trustVocabulary";

/** Older call sites used these names; they map onto the semantic tones. */
type LegacyTone = "verified" | "pending" | "danger" | "default";

const LEGACY: Record<LegacyTone, StatusTone> = { verified: "positive", pending: "neutral", danger: "negative", default: "neutral" };

export type StatusIcon = "check" | "clock" | "alert" | "x" | "ban" | "minus" | "dot";

const ICONS: Record<StatusIcon, LucideIcon> = { check: CheckCircle2, clock: Clock, alert: AlertTriangle, x: XCircle, ban: Ban, minus: MinusCircle, dot: Circle };
const DEFAULT_ICON: Record<StatusTone, StatusIcon> = { positive: "check", info: "clock", neutral: "minus", warning: "alert", negative: "x" };

interface StatusPillProps {
  label: string;
  tone: StatusTone | LegacyTone;
  /** Longer explanation, exposed as a tooltip and to assistive technology. */
  description?: string;
  icon?: StatusIcon;
  className?: string;
}

/**
 * The only status badge in the product. Colour carries one meaning
 * (see lib/trustVocabulary): never use it to decorate.
 */
export function StatusPill({ label, tone, description, icon, className }: StatusPillProps) {
  const semantic = (tone in LEGACY ? LEGACY[tone as LegacyTone] : tone) as StatusTone;
  const Icon = ICONS[icon ?? DEFAULT_ICON[semantic]];
  return (
    <Badge
      variant={semantic}
      title={description}
      aria-label={description ? `${label}. ${description}` : undefined}
      className={cn("whitespace-nowrap", className)}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {label}
    </Badge>
  );
}
