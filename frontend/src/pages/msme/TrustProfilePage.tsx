import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, KeyRound, Layers, RefreshCw, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { TrustCard } from "@/components/shared/TrustCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState, LoadingState } from "@/components/shared/AsyncState";
import { SectionCard } from "@/components/shared/SectionCard";
import { DescriptorBadge, EvidenceBadges, EvidenceStatusBadge } from "@/components/shared/EvidenceStatusBadge";
import { ROUTES } from "@/components/layout/navigation";
import { useAppStore } from "@/store/appStore";
import { getApiError } from "@/services/api";
import { useToast } from "@/components/ui/use-toast";
import { backendFieldLabel, documentTypeLabel, sourceLabel } from "@/lib/fieldLabels";
import { fieldFreshness, fieldValueText, TRUST_FIELDS } from "@/lib/trustProfileView";
import { isTrustProfileOutdated } from "@/lib/evidenceSlots";
import { describeFreshness, NOT_EXTERNALLY_VERIFIED } from "@/lib/trustVocabulary";
import { formatDate, formatDateTime } from "@/lib/utils";

export function TrustProfilePage() {
  const { business, trustProfile, loadBusiness, generateTrustProfile, error } = useAppStore();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  useEffect(() => { loadBusiness(); }, [loadBusiness]);

  const rows = useMemo(() => {
    if (!trustProfile) return [];
    return TRUST_FIELDS.flatMap((definition) => {
      const check = trustProfile.fields.find((item) => item.field === definition.field);
      return check ? [{ ...definition, check }] : [];
    });
  }, [trustProfile]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateTrustProfile();
      toast({ title: "Trust Profile updated", description: "A new version was generated from your current claims and evidence.", variant: "success" });
    } catch (e) {
      toast({ title: "Trust Profile generation failed", description: getApiError(e), variant: "destructive" });
    } finally { setGenerating(false); }
  }

  if (error && !business) return <ErrorState message={error} onRetry={() => loadBusiness()} />;
  if (!business) return <LoadingState label="Loading your Trust Profile" />;

  const generateButton = (
    <Button onClick={handleGenerate} disabled={generating}>
      <RefreshCw className={generating ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
      {generating ? "Generating…" : trustProfile ? "Generate new version" : "Generate Trust Profile"}
    </Button>
  );

  if (!trustProfile) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Trust" title="Trust Profile" description="A versioned record of what Pramaan has checked about your business. Verifiers only ever see the parts you approve." />
        {business.lastCrossCheckedAt ? (
          <EmptyState icon={Layers} title="Ready to generate your first Trust Profile" description="It captures your current claims, evidence checks, gaps and conflicts as version 1. Access can only be shared once it exists." action={generateButton} />
        ) : (
          <EmptyState icon={Layers} title="Run an internal cross-check first" description="Your Trust Profile is built from the results of Pramaan's checks on your claims and evidence." action={<Button asChild><Link to={ROUTES.businessProfile}>Go to Business Profile</Link></Button>} />
        )}
      </div>
    );
  }

  const outdated = isTrustProfileOutdated(business, trustProfile);
  const documentsById = new Map(business.documents.map((doc) => [doc.id, doc]));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Trust"
        title="Trust Profile"
        description="Your reusable, versioned record of what Pramaan has checked. Verifiers see a fixed version, and only the items you approve."
        actions={<>{generateButton}<Button asChild variant="outline"><Link to={ROUTES.consent}><KeyRound className="h-4 w-4" />Consent & Access</Link></Button></>}
      />

      {outdated && (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Your business details or evidence changed after version {trustProfile.version}. Existing consents keep showing version {trustProfile.version}; new approvals use the newest version.
            {business.trustStatus === "SELF_DECLARED" ? " Run a cross-check, then generate a new version." : " Generate a new version to include the changes."}
          </span>
        </div>
      )}

      <TrustCard profile={trustProfile} />

      <SectionCard title="Claims and checks" description={`As recorded in version ${trustProfile.version}. Last checked ${formatDateTime(trustProfile.lastCalculatedAt ?? trustProfile.generatedAt)}.`} contentClassName="p-0 sm:p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Claims and their check status in this Trust Profile version</caption>
            <thead className="border-y border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Claim</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Value</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Freshness</th>
                <th scope="col" className="px-5 py-2.5 font-medium">How Pramaan knows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ field, label, mono, mask, check }) => {
                const freshness = describeFreshness(fieldFreshness(check));
                return (
                  <tr key={field} className="align-top">
                    <th scope="row" className="px-5 py-3 font-medium text-slate-900">{label}</th>
                    <td className={mono ? "px-3 py-3 font-mono text-[13px] text-slate-800" : "px-3 py-3 text-slate-800"}>{fieldValueText(check.value, mask)}</td>
                    <td className="px-3 py-3"><EvidenceStatusBadge status={check.status} /></td>
                    <td className="px-3 py-3">{freshness && <DescriptorBadge descriptor={freshness} />}</td>
                    <td className="px-5 py-3 text-xs leading-5 text-slate-600">{check.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Evidence behind this version" description="Check status is as recorded in this version. Freshness is as of today.">
        {trustProfile.documents.length === 0 ? (
          <EmptyState compact icon={Layers} title="No evidence in this version" description="Upload evidence, run a cross-check and generate a new version." action={<Button asChild variant="outline"><Link to={ROUTES.evidence}>Go to Evidence</Link></Button>} />
        ) : (
          <ul className="grid gap-3 md:grid-cols-3">
            {trustProfile.documents.map((doc) => {
              const stored = documentsById.get(doc.documentId);
              return (
                <li key={doc.documentId} className="rounded-lg border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-900">{documentTypeLabel(doc.documentType)}</p>
                  <div className="mt-2"><EvidenceBadges status={doc.status} lifecycle={stored?.lifecycle?.state} /></div>
                  <dl className="mt-3 space-y-1 text-xs text-slate-600">
                    <div className="flex justify-between gap-2"><dt>Source</dt><dd className="text-right text-slate-800">{sourceLabel(stored?.source)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Issued</dt><dd className="text-slate-800">{formatDate(stored?.issuedAt)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Expires</dt><dd className="text-slate-800">{formatDate(stored?.expiresAt)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Version</dt><dd className="text-slate-800">{stored?.revision ?? "—"}{stored?.isCurrent === false ? " (since replaced)" : ""}</dd></div>
                  </dl>
                  <p className="mt-3 text-xs leading-5 text-slate-500">{doc.reason}</p>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {(trustProfile.contradictions.length > 0 || trustProfile.gaps.length > 0) && (
        <SectionCard title="Conflicts and gaps" description="What the internal checks could not confirm in this version.">
          <ul className="space-y-2">
            {trustProfile.contradictions.map((item, index) => (
              <li key={`c-${index}`} className="flex gap-3 rounded-lg border border-negative-border bg-negative-bg p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-negative" aria-hidden />
                <span className="text-negative-foreground"><span className="font-semibold">Conflict · {backendFieldLabel(item.field)}.</span> {item.reason}</span>
              </li>
            ))}
            {trustProfile.gaps.map((item, index) => (
              <li key={`g-${index}`} className="flex gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden />
                <span className="text-slate-700"><span className="font-semibold text-slate-900">{backendFieldLabel(item.field)}</span> <span className="text-xs text-slate-500">({item.severity.toLowerCase()} priority)</span> — {item.message}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="What Pramaan does not verify" description="Read this before relying on the Trust Card.">
        <div className="flex gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          <ul className="list-disc space-y-1.5 pl-4 text-sm text-slate-700">
            <li>{NOT_EXTERNALLY_VERIFIED}</li>
            {trustProfile.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </div>
      </SectionCard>
    </div>
  );
}
