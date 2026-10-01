import { FileText, Info } from "lucide-react";

import { EvidenceStatusBadge } from "@/components/shared/EvidenceStatusBadge";
import { StatusPill } from "@/components/shared/StatusPill";
import { documentTypeLabel } from "@/lib/fieldLabels";
import { checkCounts, fieldValueText, SUMMARY_METRICS } from "@/lib/trustProfileView";
import { describeEvidenceStatus, overallStatusFromContradictions } from "@/lib/trustVocabulary";
import { cn, formatDateTime } from "@/lib/utils";
import type { TrustProfile } from "@/types";

function MetricBar({ label, value, hint }: { label: string; value?: number; hint: string }) {
  const pct = typeof value === "number" ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div title={hint}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-medium tabular-nums text-slate-900">{typeof value === "number" ? `${value}%` : "—"}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full", pct >= 70 ? "bg-positive" : pct >= 40 ? "bg-warning" : "bg-negative")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * The Trust Card: a reusable, versioned summary of what Pramaan has checked.
 * Everything on it comes from one stored Trust Profile snapshot.
 */
export function TrustCard({ profile }: { profile: TrustProfile }) {
  const value = (field: string) => profile.fields.find((item) => item.field === field)?.value;
  const overall = describeEvidenceStatus(overallStatusFromContradictions(profile.contradictions));
  const counts = checkCounts(profile);
  const readiness = profile.summary?.trustReadiness;

  return (
    <article aria-label="Trust Card" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-raised">
      {/* Identity band */}
      <div className="relative bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 px-5 py-6 text-white sm:px-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-200">Pramaan Trust Card</p>
            <h2 className="mt-2 break-words text-2xl font-semibold tracking-tight sm:text-[28px]">{fieldValueText(value("legalBusinessName"))}</h2>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-primary-100">
              <div className="flex gap-1.5"><dt>GSTIN</dt><dd className="font-mono text-[13px] text-white">{fieldValueText(value("gstin"))}</dd></div>
              <div className="flex gap-1.5"><dt>Udyam</dt><dd className="font-mono text-[13px] text-white">{fieldValueText(value("udyamNumber"))}</dd></div>
            </dl>
          </div>
          <div className="shrink-0 rounded-lg border border-white/15 bg-white/10 px-4 py-3 sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-200">Trust Profile</p>
            <p className="mt-0.5 text-lg font-semibold">Version {profile.version}</p>
            <p className="text-xs text-primary-100">Generated {formatDateTime(profile.generatedAt)}</p>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid gap-6 border-b border-slate-200 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <p className="text-xs font-medium text-slate-500">Overall result</p>
          <div className="mt-2"><StatusPill label={overall.label} tone={overall.tone} description={overall.description} icon={overall.icon} /></div>
          <p className="mt-4 text-xs font-medium text-slate-500">Trust readiness</p>
          <p className="mt-1 text-4xl font-semibold tracking-tight text-slate-900 tabular-nums">{typeof readiness === "number" ? `${readiness}%` : "—"}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Weighted from the four internal measures. It describes evidence quality, not creditworthiness.</p>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-slate-50 px-2 py-2"><dt className="text-[11px] text-slate-500">Cross-checked</dt><dd className="text-sm font-semibold tabular-nums text-slate-900">{counts.crossChecked}/{counts.total}</dd></div>
            <div className="rounded-md bg-slate-50 px-2 py-2"><dt className="text-[11px] text-slate-500">Conflicts</dt><dd className={cn("text-sm font-semibold tabular-nums", counts.conflicts ? "text-negative" : "text-slate-900")}>{counts.conflicts}</dd></div>
            <div className="rounded-md bg-slate-50 px-2 py-2"><dt className="text-[11px] text-slate-500">Gaps</dt><dd className={cn("text-sm font-semibold tabular-nums", counts.gaps ? "text-warning" : "text-slate-900")}>{counts.gaps}</dd></div>
          </dl>
        </div>
        <div className="space-y-5">
          <div className="space-y-3">
            {SUMMARY_METRICS.map((metric) => <MetricBar key={metric.key} label={metric.label} value={profile.summary?.[metric.key]} hint={metric.hint} />)}
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Evidence in this version</p>
            <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
              {profile.documents.length === 0 && <li className="px-3 py-2.5 text-sm text-slate-500">No evidence was on file.</li>}
              {profile.documents.map((doc) => (
                <li key={doc.documentId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm text-slate-800"><FileText className="h-4 w-4 text-slate-400" aria-hidden />{documentTypeLabel(doc.documentType)}</span>
                  <EvidenceStatusBadge status={doc.status} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <p className="flex items-start gap-2 bg-slate-50 px-5 py-3.5 text-xs leading-5 text-slate-600 sm:px-7">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
        Pramaan cross-checks the business's own claims and documents against each other. It does not query GST, Udyam, bank or other government systems, and this card is not a certificate.
      </p>
    </article>
  );
}
