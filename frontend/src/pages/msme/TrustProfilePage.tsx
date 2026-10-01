import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Inbox, Layers, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TrustProfileCard } from "@/components/shared/TrustProfileCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { EvidenceStatusBadge } from "@/components/shared/EvidenceStatusBadge";
import { useAppStore } from "@/store/appStore";
import { getApiError } from "@/services/api";
import { useToast } from "@/components/ui/use-toast";
import { backendFieldLabel } from "@/lib/fieldLabels";
import { parseDate } from "@/lib/utils";
import type { Business, TrustProfile } from "@/types";

/** True when claims or evidence changed after this Trust Profile version was generated. */
function isOutdated(business: Business, profile: TrustProfile): boolean {
  const generated = parseDate(profile.generatedAt)?.getTime() ?? 0;
  const newerEvidence = business.documents.some((doc) => doc.isCurrent !== false && (parseDate(doc.uploadedAt)?.getTime() ?? 0) > generated);
  // Saving business details resets the backend status to SELF_DECLARED until the next cross-check.
  return newerEvidence || business.trustStatus === "SELF_DECLARED";
}

export function TrustProfilePage() {
  const navigate = useNavigate();
  const { business, trustProfile, loadBusiness, generateTrustProfile, error } = useAppStore();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadBusiness();
  }, [loadBusiness]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateTrustProfile();
      toast({ title: "Trust Profile updated", description: "A new version was generated from your current claims and evidence." });
    }
    catch (error) { toast({ title: "Trust Profile generation failed", description: getApiError(error), variant: "destructive" }); }
    finally { setGenerating(false); }
  }

  if (error && !business) return <EmptyState icon={Layers} title="Could not load your Trust Profile" description={error} action={<Button onClick={() => loadBusiness()}>Try again</Button>} />;
  if (!business) return <EmptyState icon={Layers} title="Loading your Trust Profile" description="Reading your latest business and Trust Profile state." />;

  if (!trustProfile) {
    if (!business.lastCrossCheckedAt) {
      return (
        <EmptyState
          icon={Layers}
          title="Run an internal cross-check first"
          description="Your Trust Profile is generated from your business claims and the evidence Pramaan has cross-checked."
          action={<Button onClick={() => navigate("/msme/verification")}>Go to Business Profile</Button>}
        />
      );
    }
    return (
      <EmptyState
        icon={Layers}
        title="Ready to generate your Trust Profile"
        description="Generate a versioned Trust Profile from your cross-checked claims and evidence. Buyers and banks only see the parts you approve."
        action={
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? "Generating..." : "Generate Trust Profile"}
          </Button>
        }
      />
    );
  }

  const outdated = isOutdated(business, trustProfile);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Trust Profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your reusable, versioned record of what Pramaan has checked. Share only what is needed, with consent.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleGenerate} disabled={generating}>
            <RefreshCw className="h-4 w-4" />
            {generating ? "Generating…" : "Generate new version"}
          </Button>
          <Button onClick={() => navigate("/msme/consent-requests")}>
            <Inbox className="h-4 w-4" />
            Consent requests
          </Button>
        </div>
      </div>

      {outdated && (
        <div role="status" className="flex items-start gap-3 rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Your business details or evidence changed after version {trustProfile.version} was generated. Verifiers with active consent still see version {trustProfile.version}.
            {business.trustStatus === "SELF_DECLARED" ? " Run a cross-check, then generate a new version." : " Generate a new version to include the changes."}
          </span>
        </div>
      )}

      <TrustProfileCard trustProfile={trustProfile} />

      {(trustProfile.gaps.length > 0 || trustProfile.contradictions.length > 0) && (
        <SectionCard title="What this version still needs" description="Recorded in this Trust Profile version by Pramaan's internal checks.">
          <ul className="space-y-2">
            {trustProfile.contradictions.map((item, index) => (
              <li key={`c-${index}`} className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span><span className="font-medium text-slate-800">{backendFieldLabel(item.field)}</span> — {item.reason}</span>
                <EvidenceStatusBadge status="REJECTED" />
              </li>
            ))}
            {trustProfile.gaps.map((item, index) => (
              <li key={`g-${index}`} className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span><span className="font-medium text-slate-800">{backendFieldLabel(item.field)}</span> — {item.message}</span>
                <span className="text-xs font-medium text-muted-foreground">{item.severity.toLowerCase()} priority</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
