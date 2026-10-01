import { CalendarDays, Info, Layers } from "lucide-react";

import { EvidenceStatusBadge } from "@/components/shared/EvidenceStatusBadge";
import { NOT_EXTERNALLY_VERIFIED, describeEvidenceStatus, overallStatusFromContradictions } from "@/lib/trustVocabulary";
import { formatDateTime, maskPan } from "@/lib/utils";
import type { TrustProfile } from "@/types";

interface TrustCardProps {
  trustProfile: TrustProfile;
}

function snapshotValue(profile: TrustProfile, field: string): string {
  const value = profile.fields.find((item) => item.field === field)?.value;
  return typeof value === "string" && value ? value : "Not provided";
}

function CheckRow({ label, value, status }: { label: string; value: string; status?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-2 truncate font-mono text-sm font-medium text-white" title={value}>{value}</p>
      <div className="mt-2"><EvidenceStatusBadge status={status} /></div>
    </div>
  );
}

/**
 * Trust Card: the visual representation of one Trust Profile version.
 * Every value and status comes from the stored snapshot, so the card shows
 * exactly what a verifier with consent would be shown for this version.
 */
export function TrustProfileCard({ trustProfile }: TrustCardProps) {
  const fieldStatus = (field: string) => trustProfile.fields.find((item) => item.field === field)?.status;
  const bank = trustProfile.documents.find((doc) => doc.documentType === "BANK_STATEMENT");
  const overall = describeEvidenceStatus(overallStatusFromContradictions(trustProfile.contradictions));
  const readiness = trustProfile.summary?.trustReadiness;

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 p-1 shadow-[0_30px_100px_rgba(15,23,42,0.24)]">
      <div className="absolute inset-x-16 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/80 to-transparent" />
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-blue-700/25 blur-3xl" />

      <div className="relative rounded-[1.75rem] border border-white/10 bg-white/[0.07] p-6 text-white backdrop-blur-2xl sm:p-7">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-200/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-cyan-100">
              <Layers className="h-3.5 w-3.5" aria-hidden />
              Trust Card
            </div>
            <h2 className="mt-5 max-w-xl break-words text-3xl font-semibold tracking-tight sm:text-4xl">
              {snapshotValue(trustProfile, "legalBusinessName")}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-slate-300">{snapshotValue(trustProfile, "address")}</p>
          </div>
          {typeof readiness === "number" && (
            <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-right">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Trust readiness</p>
              <p className="mt-1 text-2xl font-semibold">{readiness}%</p>
            </div>
          )}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CheckRow label="GSTIN" value={snapshotValue(trustProfile, "gstin")} status={fieldStatus("gstin")} />
          <CheckRow label="Udyam" value={snapshotValue(trustProfile, "udyamNumber")} status={fieldStatus("udyamNumber")} />
          <CheckRow label="PAN" value={maskPan(snapshotValue(trustProfile, "pan"))} status={fieldStatus("pan")} />
          <CheckRow label="Bank evidence" value={bank ? "Bank statement submitted" : "Not submitted"} status={bank?.status} />
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3 border-t border-white/10 pt-5 text-sm sm:grid-cols-4">
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Overall</p>
            <p className="mt-2 font-medium text-white">{overall.label}</p>
          </div>
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Gaps · Conflicts</p>
            <p className="mt-2 font-medium text-white">{trustProfile.gaps.length} · {trustProfile.contradictions.length}</p>
          </div>
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Version</p>
            <p className="mt-2 font-medium text-white">v{trustProfile.version}</p>
          </div>
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Generated</p>
            <p className="mt-2 flex items-center gap-2 font-medium text-white">
              <CalendarDays className="h-4 w-4 shrink-0 text-cyan-200" aria-hidden />
              {formatDateTime(trustProfile.generatedAt)}
            </p>
          </div>
        </div>

        <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {NOT_EXTERNALLY_VERIFIED} Verifiers only see what you approve; document files themselves are never shared.
        </p>
      </div>
    </div>
  );
}
