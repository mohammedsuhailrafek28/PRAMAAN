import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Archive, ArrowRight, CheckCircle2, Gauge, Info, KeyRound, Layers, Link2, ListChecks, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionCard } from "@/components/shared/SectionCard";
import { AuditTimeline } from "@/components/shared/AuditTimeline";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState, LoadingState } from "@/components/shared/AsyncState";
import { EvidenceStatusBadge, LifecycleBadge } from "@/components/shared/EvidenceStatusBadge";
import { ROUTES } from "@/components/layout/navigation";
import { useAppStore } from "@/store/appStore";
import { evidenceHealth, evidenceSlots, isTrustProfileOutdated } from "@/lib/evidenceSlots";
import { deriveNextActions, type ActionTone } from "@/lib/nextActions";
import { scopeSize } from "@/lib/disclosure";
import { cn, formatDate, timeUntil } from "@/lib/utils";

function SummaryTile({ icon: Icon, label, value, detail, to, children }: { icon: LucideIcon; label: string; value: string; detail?: string; to: string; children?: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-border bg-white p-4 shadow-card transition-all hover:-translate-y-px hover:border-primary-200 hover:shadow-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-medium text-slate-500"><Icon className="h-4 w-4 text-slate-400" aria-hidden />{label}</p>
        <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-primary-700" aria-hidden />
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-slate-500">{detail}</p>}
      {children && <div className="mt-2.5 flex flex-wrap gap-1.5">{children}</div>}
    </Link>
  );
}

const ACTION_TONE: Record<ActionTone, { icon: LucideIcon; chip: string }> = {
  negative: { icon: AlertTriangle, chip: "bg-negative-bg text-negative" },
  warning: { icon: AlertTriangle, chip: "bg-warning-bg text-warning" },
  info: { icon: Info, chip: "bg-info-bg text-info" },
};

export function MsmeDashboard() {
  const { business, trustProfile, consentRequests, accessGrants, auditLogs, loadBusiness, loadConsentRequests, loadAccessGrants, loadAuditLogs, loading, error } = useAppStore();

  useEffect(() => {
    loadBusiness();
    loadConsentRequests();
    loadAccessGrants();
    loadAuditLogs();
  }, [loadBusiness, loadConsentRequests, loadAccessGrants, loadAuditLogs]);

  const slots = useMemo(() => evidenceSlots(business), [business]);
  const health = useMemo(() => evidenceHealth(slots), [slots]);
  const pending = consentRequests.filter((r) => r.status === "pending");
  const activeConsents = consentRequests.filter((r) => r.status === "active");
  const activeLinks = accessGrants.filter((g) => g.status === "ACTIVE");
  const actions = useMemo(() => deriveNextActions({ business, trustProfile, slots, pendingRequests: pending }), [business, trustProfile, slots, pending]);

  if (!business && error) return <ErrorState message={error} onRetry={() => loadBusiness()} />;
  if (!business) return <LoadingState label="Loading your workspace" />;

  const outdated = trustProfile ? isTrustProfileOutdated(business, trustProfile) : false;
  const readiness = business.trustSummary?.trustReadiness;
  const attention = health.total - health.current;

  return (
    <div className="space-y-6">
      {/* Identity */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary-700">Your business</p>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-900">{business.legalName || "Business name not set"}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
              <span>GSTIN <span className="font-mono text-[13px] text-slate-900">{business.gstin || "—"}</span></span>
              <span>Udyam <span className="font-mono text-[13px] text-slate-900">{business.udyamNumber || "—"}</span></span>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            {business.lastCrossCheckedAt ? <EvidenceStatusBadge status={business.trustStatus} /> : <span className="text-xs text-slate-500">Not cross-checked yet</span>}
            <span className="text-xs text-slate-500">{business.lastCrossCheckedAt ? `Last internal cross-check ${formatDate(business.lastCrossCheckedAt)}` : "Run a cross-check to get started"}</span>
          </div>
        </div>
      </Card>

      {/* State at a glance */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          icon={Layers}
          label="Trust Profile"
          value={trustProfile ? `Version ${trustProfile.version}` : "Not generated"}
          detail={trustProfile ? (outdated ? `Changes since ${formatDate(trustProfile.generatedAt)}` : `Up to date · ${formatDate(trustProfile.generatedAt)}`) : "Needed before sharing"}
          to={ROUTES.trustProfile}
        />
        <SummaryTile
          icon={Gauge}
          label="Trust readiness"
          value={typeof readiness === "number" ? `${readiness}%` : "—"}
          detail={typeof readiness === "number" ? "Weighted result of internal checks" : "Available after a cross-check"}
          to={ROUTES.trustProfile}
        />
        <SummaryTile icon={Archive} label="Evidence health" value={`${health.current} of ${health.total} current`} to={ROUTES.evidence}>
          {health.missing > 0 && <EvidenceStatusBadge status={null} />}
          {health.stale > 0 && <LifecycleBadge state="EXPIRED" />}
          {health.expiringSoon > 0 && <LifecycleBadge state="EXPIRING_SOON" />}
          {health.conflict > 0 && <LifecycleBadge state="CONFLICT" />}
          {attention === 0 && <LifecycleBadge state="CURRENT" />}
        </SummaryTile>
        <SummaryTile
          icon={KeyRound}
          label="Access"
          value={`${activeConsents.length + activeLinks.length} active`}
          detail={pending.length ? `${pending.length} request${pending.length === 1 ? "" : "s"} awaiting your decision` : "No requests waiting"}
          to={ROUTES.consent}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Action Center */}
        <SectionCard
          className="lg:col-span-2"
          title="Action Center"
          description={actions.length ? `${actions.length} thing${actions.length === 1 ? "" : "s"} to do, most important first.` : undefined}
        >
          {actions.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-positive-border bg-positive-bg p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-positive" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-positive-foreground">Nothing needs your attention</p>
                <p className="mt-0.5 text-sm text-positive-foreground/80">Your evidence is current, your Trust Profile is up to date, and no requests are waiting.</p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {actions.map((action) => {
                const tone = ACTION_TONE[action.tone];
                return (
                  <li key={action.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 gap-3">
                      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", tone.chip)}>
                        <tone.icon className="h-4 w-4" aria-hidden />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{action.title}</p>
                        <p className="mt-0.5 text-sm text-slate-600">{action.description}</p>
                      </div>
                    </div>
                    <Button asChild size="sm" variant={action.tone === "info" ? "default" : "outline"} className="shrink-0">
                      <Link to={action.to}>{action.cta}</Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        {/* Who has access */}
        <SectionCard
          title="Who has access now"
          action={<Button asChild variant="ghost" size="sm"><Link to={ROUTES.consent}>Manage<ArrowRight className="h-3.5 w-3.5" /></Link></Button>}
        >
          {activeConsents.length + activeLinks.length === 0 ? (
            <p className="text-sm text-slate-600">No one can see your information right now. Access is only granted when you approve a request or create a secure link.</p>
          ) : (
            <ul className="space-y-3">
              {activeConsents.map((request) => (
                <li key={request.id} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600"><KeyRound className="h-3.5 w-3.5" aria-hidden /></div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{request.requesterName}</p>
                    <p className="text-xs text-slate-500">{scopeSize(request.approved)} item{scopeSize(request.approved) === 1 ? "" : "s"} · {request.purpose || "Verification"} · {timeUntil(request.expiresAt)}</p>
                  </div>
                </li>
              ))}
              {activeLinks.map((grant) => (
                <li key={grant.id} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600"><Link2 className="h-3.5 w-3.5" aria-hidden /></div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{grant.recipientOrganization || grant.recipientName || "Secure link recipient"}</p>
                    <p className="text-xs text-slate-500">Secure link · {scopeSize(grant.scope)} item{scopeSize(grant.scope) === 1 ? "" : "s"} · {timeUntil(grant.expiresAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Recent activity"
        action={<Button asChild variant="ghost" size="sm"><Link to={ROUTES.activity}>View all<ArrowRight className="h-3.5 w-3.5" /></Link></Button>}
      >
        {auditLogs.length === 0 && !loading ? (
          <EmptyState compact icon={ListChecks} title="No activity yet" description="Evidence uploads, cross-checks and every access decision will be recorded here." />
        ) : (
          <AuditTimeline logs={auditLogs} limit={5} />
        )}
      </SectionCard>
    </div>
  );
}
