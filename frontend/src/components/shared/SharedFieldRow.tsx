import { EvidenceStatusBadge } from "@/components/shared/EvidenceStatusBadge";
import type { SharedField } from "@/types";

/** One disclosed field. A status badge appears only when the snapshot recorded one. */
export function SharedFieldRow({ field }: { field: SharedField }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{field.label}</p>
        {field.status && <EvidenceStatusBadge status={field.status} />}
      </div>
      <p className="mt-1.5 break-words text-sm font-medium text-slate-800">{field.value}</p>
      {field.reason && <p className="mt-1 text-xs text-muted-foreground">{field.reason}</p>}
      {field.items && field.items.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {field.items.map((item) => (
            <li key={item.label} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <span>{item.label}{item.detail && !item.status ? `: ${item.detail}` : ""}</span>
              {item.status && <EvidenceStatusBadge status={item.status} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
