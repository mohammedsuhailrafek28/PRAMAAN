import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Fact {
  label: string;
  value: ReactNode;
  /** Use a monospace face for identifiers (GSTIN, Udyam). */
  mono?: boolean;
}

/** Compact label/value grid for metadata. Renders as a description list. */
export function FactList({ facts, columns = 2, className }: { facts: Fact[]; columns?: 2 | 3 | 4; className?: string }) {
  const cols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[columns];
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", cols, className)}>
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-xs font-medium text-slate-500">{fact.label}</dt>
          <dd className={cn("mt-0.5 break-words text-sm text-slate-900", fact.mono && "font-mono text-[13px]")}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
