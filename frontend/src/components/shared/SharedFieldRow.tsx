import { FileText } from "lucide-react";

import { DescriptorBadge, EvidenceBadges, EvidenceStatusBadge } from "@/components/shared/EvidenceStatusBadge";
import { disclosureItem } from "@/lib/disclosure";
import { describeFreshness, describeSource } from "@/lib/trustVocabulary";
import { formatDate } from "@/lib/utils";
import type { SharedEvidence, SharedField } from "@/types";

const MONO_KEYS = new Set(["gstin", "udyamNumber"]);

/** One disclosed field: value, check status, freshness and provenance. */
export function SharedFieldRow({ field }: { field: SharedField }) {
  const freshness = describeFreshness(field.freshnessState);
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{field.label}</p>
        {!field.computed && (
          <span className="flex flex-wrap gap-1.5">
            {field.status && <EvidenceStatusBadge status={field.status} />}
            {freshness && field.freshnessState !== "CURRENT" && <DescriptorBadge descriptor={freshness} />}
          </span>
        )}
      </div>
      <p className={MONO_KEYS.has(field.key) ? "mt-1.5 break-all font-mono text-[15px] font-medium text-slate-900" : "mt-1.5 break-words text-[15px] font-medium text-slate-900"}>{field.value}</p>
      {field.items && field.items.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {field.items.map((item) => (
            <div key={item.label} className="flex justify-between gap-2 text-xs"><dt className="text-slate-500">{item.label}</dt><dd className="font-medium tabular-nums text-slate-800">{item.detail}</dd></div>
          ))}
        </dl>
      )}
      <p className="mt-2 text-xs text-slate-500">
        {field.computed ? "Calculated by Pramaan from internal checks" : describeSource(field.source)}
        {field.lastCheckedAt && ` · checked ${formatDate(field.lastCheckedAt)}`}
      </p>
    </div>
  );
}

/** One disclosed evidence item: never the file, only its check status, freshness and dates. */
export function SharedEvidenceRow({ evidence }: { evidence: SharedEvidence }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><FileText className="h-4 w-4 text-slate-500" aria-hidden />{disclosureItem(evidence.docType)?.label ?? evidence.docType}</p>
        <EvidenceBadges status={evidence.evidenceStatus} lifecycle={evidence.lifecycle?.state} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
        <div><dt className="text-slate-500">Source</dt><dd className="text-slate-800">{describeSource(evidence.source)}</dd></div>
        <div><dt className="text-slate-500">Issued</dt><dd className="text-slate-800">{formatDate(evidence.issuedAt)}</dd></div>
        <div><dt className="text-slate-500">Expires</dt><dd className="text-slate-800">{evidence.expiresAt ? formatDate(evidence.expiresAt) : "No expiry recorded"}</dd></div>
        <div><dt className="text-slate-500">Last checked</dt><dd className="text-slate-800">{formatDate(evidence.checkedAt)}</dd></div>
      </dl>
    </div>
  );
}
