import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Ban, Clock, Info, Layers, Link2Off } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/shared/StatusPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { FactList } from "@/components/shared/FactList";
import { SharedEvidenceRow, SharedFieldRow } from "@/components/shared/SharedFieldRow";
import { ErrorState, LoadingState } from "@/components/shared/AsyncState";
import { getApiError, getGuestVerification } from "@/services/api";
import { NOT_EXTERNALLY_VERIFIED } from "@/lib/trustVocabulary";
import type { GuestLinkFailure, GuestVerificationView } from "@/types";
import { formatDateTime, timeUntil } from "@/lib/utils";

const FAILURE_COPY: Record<GuestLinkFailure, { icon: typeof Ban; title: string; body: string }> = {
  revoked: { icon: Ban, title: "Access was revoked", body: "The business has withdrawn this link. Ask them for a new one if you still need this information." },
  expired: { icon: Clock, title: "This link has expired", body: "The access period the business chose has ended. Ask them for a new link if you still need this information." },
  invalid: { icon: Link2Off, title: "This link isn't valid", body: "Check that you copied the full link, or ask the business to send it again." },
  unavailable: { icon: AlertTriangle, title: "Shared information unavailable", body: "The Trust Profile version this link shares is no longer available. Ask the business for a new link." },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2.5 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-800 text-xs font-bold text-white" aria-hidden>P</div>
          <span className="text-sm font-semibold text-slate-900">Pramaan</span>
          <span className="text-xs text-slate-500">· Secure link</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}

/** Public page for someone the business shared a secure link with. No account needed. */
export function ExternalVerificationPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<GuestVerificationView | null>(null);
  const [failure, setFailure] = useState<GuestLinkFailure | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getGuestVerification(token)
      .then((result) => ("view" in result ? setView(result.view) : setFailure(result.failure)))
      .catch((e) => setError(getApiError(e)));
  }, [token]);

  if (failure) {
    const copy = FAILURE_COPY[failure];
    return (
      <Shell>
        <Card className="mx-auto mt-8 flex max-w-md flex-col items-center px-6 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600"><copy.icon className="h-5 w-5" aria-hidden /></div>
          <h1 className="mt-3 text-xl font-semibold text-slate-900">{copy.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{copy.body}</p>
        </Card>
      </Shell>
    );
  }
  if (error) return <Shell><ErrorState message={error} /></Shell>;
  if (!view) return <Shell><LoadingState label="Loading shared information" /></Shell>;

  const version = view.grant.profileVersion;

  return (
    <Shell>
      <div className="space-y-6">
        <header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary-700">Shared with you via secure link</p>
            <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight text-slate-900">{view.business.legalName || "Shared business information"}</h1>
            <p className="mt-1 text-sm text-slate-600">Shared by the business for {view.grant.purpose.toLowerCase()}.</p>
          </div>
          <StatusPill label={`Link active · ${timeUntil(view.grant.expiresAt)}`} tone="positive" />
        </header>

        <SectionCard title="Overview">
          <FactList
            columns={4}
            facts={[
              { label: "Shared with", value: view.grant.recipientOrganization || view.grant.recipientName || "Not specified" },
              { label: "Shared on", value: formatDateTime(view.grant.createdAt) },
              { label: "Expires", value: formatDateTime(view.grant.expiresAt) },
              { label: "Trust Profile", value: <span className="inline-flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-slate-500" aria-hidden />{version ? `Shared from v${version}` : "Fixed version"}</span> },
            ]}
          />
        </SectionCard>

        {view.fields.length > 0 && (
          <SectionCard title="Shared information" description={`Values as recorded in Trust Profile${version ? ` v${version}` : ""} when the link was created.`}>
            <div className="grid gap-3 sm:grid-cols-2">{view.fields.map((field) => <SharedFieldRow key={field.key} field={field} />)}</div>
          </SectionCard>
        )}
        {view.evidence.length > 0 && (
          <SectionCard title="Shared evidence" description="Check status, freshness and dates only. Document files are never shared.">
            <div className="space-y-3">{view.evidence.map((evidence) => <SharedEvidenceRow key={`${evidence.docType}-${evidence.uploadedAt}`} evidence={evidence} />)}</div>
          </SectionCard>
        )}

        <p className="flex items-start gap-2 text-xs leading-5 text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Only information the business explicitly chose to share is shown. {NOT_EXTERNALLY_VERIFIED} This is not a certificate.</span>
        </p>
      </div>
    </Shell>
  );
}
