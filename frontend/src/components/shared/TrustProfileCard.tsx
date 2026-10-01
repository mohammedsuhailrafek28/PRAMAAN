import { BadgeCheck, CalendarDays, Fingerprint, QrCode, ShieldCheck } from "lucide-react";

import type { Business, TrustProfile } from "@/types";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface TrustProfileCardProps {
  business: Business;
  trustProfile: TrustProfile;
}

function MiniQr() {
  return (
    <div className="grid h-24 w-24 grid-cols-6 gap-1 rounded-2xl border border-white/10 bg-white/10 p-2">
      {Array.from({ length: 36 }).map((_, index) => (
        <span
          key={index}
          className={cn(
            "rounded-[3px]",
            [0, 1, 2, 6, 12, 14, 17, 20, 21, 24, 28, 30, 31, 32, 35].includes(index)
              ? "bg-white"
              : "bg-white/20"
          )}
        />
      ))}
    </div>
  );
}

function VerifiedRow({ label, value, verified }: { label: string; value: string; verified: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        <p className="truncate font-mono text-sm font-medium text-white">{value}</p>
        {verified && <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-300" />}
      </div>
    </div>
  );
}

/**
 * Premium digital credential view of a Trust Profile. It is intentionally
 * passport-like: versioned, date-stamped, consent-aware, and field-verified.
 */
export function TrustProfileCard({ business, trustProfile }: TrustProfileCardProps) {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 p-1 shadow-[0_30px_100px_rgba(15,23,42,0.24)]">
      <div className="absolute inset-x-16 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/80 to-transparent" />
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-blue-700/25 blur-3xl" />

      <div className="relative rounded-[1.75rem] border border-white/10 bg-white/[0.07] p-6 text-white backdrop-blur-2xl sm:p-7">
        <div className="flex flex-col justify-between gap-6 sm:flex-row">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-200/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-cyan-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              Business Trust Passport
            </div>
            <h2 className="mt-5 max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">
              {business.legalName}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-slate-300">{business.address}</p>
          </div>

          <div className="flex items-start gap-4">
            <MiniQr />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <VerifiedRow label="GSTIN" value={business.gstin} verified={business.fieldVerification.gstin} />
          <VerifiedRow label="Udyam" value={business.udyamNumber} verified={business.fieldVerification.udyamNumber} />
          <VerifiedRow label="PAN" value={`${business.pan.slice(0, 3)}XXXX${business.pan.slice(-1)}`} verified={business.fieldVerification.pan} />
          <VerifiedRow label="Bank" value={trustProfile.bankVerificationStatus} verified={trustProfile.bankVerificationStatus === "Verified"} />
        </div>

        <div className="mt-7 grid grid-cols-1 gap-3 border-t border-white/10 pt-5 text-sm sm:grid-cols-4">
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Status</p>
            <p className="mt-2 flex items-center gap-2 font-medium text-emerald-200">
              <Fingerprint className="h-4 w-4" />
              {trustProfile.complianceStatus}
            </p>
          </div>
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Consent</p>
            <p className="mt-2 font-medium text-cyan-100">Owner controlled</p>
          </div>
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Version</p>
            <p className="mt-2 font-medium text-white">v{trustProfile.version}</p>
          </div>
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Generated</p>
            <p className="mt-2 flex items-center gap-2 font-medium text-white">
              <CalendarDays className="h-4 w-4 text-cyan-200" />
              {formatDate(trustProfile.generatedAt)}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <QrCode className="h-3.5 w-3.5" />
            Dynamic credential, not a static PDF
          </span>
          <span>Raw documents are never shared with stakeholders</span>
        </div>
      </div>
    </div>
  );
}
