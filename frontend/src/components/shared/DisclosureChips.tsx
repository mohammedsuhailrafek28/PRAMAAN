import { FileText } from "lucide-react";

import { disclosureItem, type DisclosureScope } from "@/lib/disclosure";

interface DisclosureChipsProps {
  scope: DisclosureScope;
  /** Items requested but not approved, shown struck through. */
  withheld?: DisclosureScope;
}

function Chip({ label, evidence, withheld }: { label: string; evidence: boolean; withheld?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${withheld ? "border-border bg-white text-slate-400 line-through" : evidence ? "border-primary-100 bg-primary-50 text-primary-700" : "border-border bg-surface text-slate-600"}`}
    >
      {evidence && <FileText className="h-3 w-3" aria-hidden />}
      {label}
      {withheld && <span className="sr-only"> (not shared)</span>}
    </span>
  );
}

/** Read-only rendering of a disclosure scope: fields as plain chips, evidence with a document icon. */
export function DisclosureChips({ scope, withheld }: DisclosureChipsProps) {
  const label = (key: string) => disclosureItem(key)?.label ?? key;
  return (
    <div className="flex flex-wrap gap-1.5">
      {scope.fields.map((key) => <Chip key={key} label={label(key)} evidence={false} />)}
      {scope.evidence.map((key) => <Chip key={key} label={label(key)} evidence />)}
      {withheld?.fields.map((key) => <Chip key={`w-${key}`} label={label(key)} evidence={false} withheld />)}
      {withheld?.evidence.map((key) => <Chip key={`w-${key}`} label={label(key)} evidence withheld />)}
    </div>
  );
}

