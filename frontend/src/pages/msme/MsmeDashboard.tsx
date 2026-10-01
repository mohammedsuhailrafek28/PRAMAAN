import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, BadgeCheck, Inbox, History, ArrowRight, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/shared/MetricCard";
import { SectionCard } from "@/components/shared/SectionCard";
import { AuditTimeline } from "@/components/shared/AuditTimeline";
import { EmptyState } from "@/components/shared/EmptyState";
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
  const verified = business?.trustStatus === "CROSS_CHECKED";
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
          Here's the current state of your business verification profile.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Business Verification"
          value={verified ? "Cross-checked" : business?.trustStatus === "REJECTED" ? "Needs review" : "Not checked"}
          icon={ShieldCheck}
          tone={verified ? "verified" : "warning"}
        />
        <MetricCard
          label="Verification Profile"
          value={trustProfile ? `Generated · v${trustProfile.version}` : "Not generated"}
          icon={BadgeCheck}
          tone={trustProfile ? "verified" : "default"}
        />
        <MetricCard
          label="Pending Consent Requests"
          value={String(pendingCount)}
          icon={Inbox}
          tone={pendingCount > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="Recent Audit Events"
          value={String(auditLogs.length)}
          icon={History}
        />
      </div>

      <SectionCard title="Verification readiness" action={<Button variant="ghost" size="sm" onClick={() => navigate("/msme/evidence-vault")}>Open Evidence Vault <ArrowRight className="h-3.5 w-3.5" /></Button>}>
        <p className="text-sm font-medium text-slate-900">{readyEvidence} of {evidenceRows.length} supported evidence items current</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {evidenceRows.map((row) => <div key={row.label} className="flex items-center gap-2 rounded-md border border-border px-3 py-3 text-sm"><span className={row.state === "CURRENT" ? "text-verified-foreground" : "text-warning-foreground"}>{row.state === "CURRENT" ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}</span><span className="min-w-0"><span className="block font-medium text-slate-800">{row.label}</span><span className="text-xs text-muted-foreground">{row.document ? ({ CURRENT: "Current", EXPIRING_SOON: "Expiring soon", EXPIRED: "Expired", CONFLICT: "Conflict detected", NEEDS_ATTENTION: "Needs attention" } as const)[row.state] : "Missing"}</span></span></div>)}
        </div>
        {evidenceRows.some((row) => row.state !== "CURRENT") && <p className="mt-4 text-xs text-muted-foreground">Items needing attention can be updated in the Evidence Vault. No external registry or bank verification is performed.</p>}
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Button variant={verified ? "outline" : "default"} onClick={() => navigate("/msme/verification")}>
          {verified ? "Review evidence" : "Complete cross-check"}
        </Button>
        <Button variant="outline" onClick={() => navigate("/msme/trust-profile")}>
          View Verification Profile
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
            icon={History}
            title="Nothing has happened yet"
            description="Complete verification to generate your Verification Profile and start seeing activity here."
          />
        ) : (
          <AuditTimeline logs={auditLogs.slice(0, 5)} />
        )}
      </SectionCard>
    </div>
  );
}
