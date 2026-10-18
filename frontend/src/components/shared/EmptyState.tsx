import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  /** Compact variant for use inside cards. */
  compact?: boolean;
}

/** Intentional empty state: says what will appear here and how to get it there. */
export function EmptyState({ icon: Icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-center", compact ? "px-4 py-8" : "px-6 py-14")}>
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100">
        <Icon className="h-5 w-5 text-slate-500" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-slate-600">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
