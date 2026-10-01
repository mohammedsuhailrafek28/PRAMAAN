import { FileText, Type } from "lucide-react";

import { disclosureItem, type DisclosureScope } from "@/lib/disclosure";

/**
 * Information (fields) and Evidence (documents) side by side. Items that were
 * requested but not shared are listed as withheld.
 */
export function ScopeColumns({ scope, withheld, emptyText = "None" }: { scope: DisclosureScope; withheld?: DisclosureScope; emptyText?: string }) {
  const column = (title: string, Icon: typeof Type, keys: string[], withheldKeys: string[] = []) => (
    <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {title}
      </p>
      {keys.length === 0 && withheldKeys.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">{emptyText}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {keys.map((key) => <li key={key} className="text-sm text-slate-800">{disclosureItem(key)?.label ?? key}</li>)}
          {withheldKeys.map((key) => (
            <li key={`w-${key}`} className="text-sm text-slate-400">
              <span className="line-through">{disclosureItem(key)?.label ?? key}</span>
              <span className="ml-1.5 text-xs no-underline">not shared</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {column("Information", Type, scope.fields, withheld?.fields)}
      {column("Evidence", FileText, scope.evidence, withheld?.evidence)}
    </div>
  );
}
