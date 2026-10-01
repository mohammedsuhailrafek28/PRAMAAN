import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ListChecks, Layers, Inbox, KeyRound, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/shared/MetricCard";
import { SectionCard } from "@/components/shared/SectionCard";
import { AuditTimeline } from "@/components/shared/AuditTimeline";
import { EmptyState } from "@/components/shared/EmptyState";
import { LifecycleBadge } from "@/components/shared/EvidenceStatusBadge";
import { describeEvidenceStatus, MISSING_EVIDENCE } from "@/lib/trustVocabulary";
import { formatDate } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";

export function MsmeDashboard() {
  const navigate = useNavigate();
  const { business, trustProfile, consentRequests, auditLogs, loadBusiness, loadConsentRequests, loadAuditLogs, error } =
    useAppStore();

  useEffect(() => {
    loadBusiness();
    loadConsentRequests();
    loadAuditLogs();
  }, [loadBusiness, loadConsentRequests, loadAuditLogs]);

  const pendingCount = consentRequests.filter((r) => r.status === "pending").length;
  const activeCount = consentRequests.filter((r) => r.status === "active").length;
  const verified = business?.trustStatus === "CROSS_CHECKED";
  const checkStatus = business?.lastCrossCheckedAt ? describeEvidenceStatus(business.trustStatus) : null;
  const evidenceTypes = [
    ["gst_certificate", "GST evidence"],
    ["udyam_certificate", "Udyam evidence"],
    ["bank_statement", "Bank evidence"],
  ] as const;
  const evidenceRows = evidenceTypes.map(([type, label]) => {
    const document = business?.documents.filter((item) => item.type === type && item.isCurrent !== false).sort((a, b) => (b.revision || 1) - (a.revision || 1))[0];
    return { label, document, state: document?.lifecycle?.state || "NEEDS_ATTENTION" as const };
  });
  const readyEvidence = evidenceRows.filter((row) => row.state === "CURRENT").length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Welcome back{business ? `, ${business.legalName}` : ""}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Here's what Pramaan currently knows about your business, and who can see it.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Internal cross-check"
          value={checkStatus ? checkStatus.label : "Not run yet"}
          hint={business?.lastCrossCheckedAt ? `Last run ${formatDate(business.lastCrossCheckedAt)}` : "Not externally verified"}
          icon={ListChecks}
          tone={verified ? "verified" : "warning"}
        />
        <MetricCard
          label="Trust Profile"
          value={trustProfile ? `Version ${trustProfile.version}` : "Not generated"}
          hint={trustProfile ? `Generated ${formatDate(trustProfile.generatedAt)}` : undefined}
          icon={Layers}
          tone={trustProfile ? "verified" : "default"}
        />
        <MetricCard
          label="Pending requests"
          value={String(pendingCount)}
          icon={Inbox}
          tone={pendingCount > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="Active consents"
          value={String(activeCount)}
          hint="Verifiers who can currently view your data"
          icon={KeyRound}
        />
      </div>

      <SectionCard title="Evidence freshness" action={<Button variant="ghost" size="sm" onClick={() => navigate("/msme/evidence-vault")}>Open Evidence Vault <ArrowRight className="h-3.5 w-3.5" /></Button>}>
        <p className="text-sm font-medium text-slate-900">{readyEvidence} of {evidenceRows.length} supported evidence items current</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {evidenceRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-3 text-sm">
              <span className="min-w-0">
                <span className="block font-medium text-slate-800">{row.label}</span>
                <span className="text-xs text-muted-foreground">{row.document ? `Version ${row.document.revision || 1}${row.document.expiresAt ? ` · expires ${formatDate(row.document.expiresAt)}` : ""}` : MISSING_EVIDENCE.description}</span>
              </span>
              <LifecycleBadge state={row.document ? row.state : null} />
            </div>
          ))}
        </div>
        {evidenceRows.some((row) => row.state !== "CURRENT") && <p className="mt-4 text-xs text-muted-foreground">Items needing attention can be updated in the Evidence Vault. Pramaan does not query GST, Udyam, or bank systems.</p>}
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Button variant={verified ? "outline" : "default"} onClick={() => navigate("/msme/verification")}>
          {verified ? "Review business profile" : "Run cross-check"}
        </Button>
        <Button variant="outline" onClick={() => navigate("/msme/trust-profile")}>
          View Trust Profile
        </Button>
        <Button variant="outline" onClick={() => navigate("/msme/consent-requests")}>
          Review Requests
        </Button>
        <Button variant="outline" onClick={() => navigate("/msme/audit-log")}>
          View Audit Log
        </Button>
      </div>

      {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}

      <SectionCard
        title="Recent activity"
        action={
          <Button variant="ghost" size="sm" onClick={() => navigate("/msme/audit-log")}>
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        }
      >
        {auditLogs.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Nothing has happened yet"
            description="Run a cross-check and generate your Trust Profile to start seeing activity here."
          />
        ) : (
          <AuditTimeline logs={auditLogs} limit={5} />
        )}
      </SectionCard>
    </div>
  );
}
