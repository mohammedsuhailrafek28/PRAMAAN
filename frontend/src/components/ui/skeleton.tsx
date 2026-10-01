import { cn } from "@/lib/utils";

/** Neutral placeholder block shown while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-shimmer rounded-md bg-slate-200/70", className)} />;
}
