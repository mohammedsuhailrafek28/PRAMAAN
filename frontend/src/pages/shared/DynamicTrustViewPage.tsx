import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Ban, Clock, Info, Layers, RefreshCw, SearchX, ShieldOff, XCircle, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { FactList } from "@/components/shared/FactList";
import { ConsentStatusBadge } from "@/components/shared/EvidenceStatusBadge";
import { ErrorState, LoadingState } from "@/components/shared/AsyncState";
import { SharedEvidenceRow, SharedFieldRow } from "@/components/shared/SharedFieldRow";
import { ScopeColumns } from "@/components/consent/ScopeColumns";
import { useAuthStore } from "@/store/authStore";
import * as api from "@/services/api";
import { getApiError } from "@/services/api";
import { withheldScope } from "@/lib/disclosure";
import { NOT_EXTERNALLY_VERIFIED, describeSource } from "@/lib/trustVocabulary";
import type { ConsentRequest, TrustViewResult } from "@/types";
import { formatDateTime, parseDate, timeUntil } from "@/lib/utils";

const CLOSED_COPY: Record<string, { icon: LucideIcon; title: string; body: string }> = {
  pending: { icon: Clock, title: "Waiting for the business", body: "Nothing is visible until the business reviews your request and approves some or all of it." },
  rejected: { icon: XCircle, title: "The business declined this request", body: "No information was shared. You can send a new, narrower request if you still need it." },
  revoked: { icon: Ban, title: "Access was revoked", body: "The business withdrew your access. Send a new request if you still need this information." },
  expired: { icon: Clock, title: "Access period ended", body: "The time the business approved has passed. Send a new request if you still need this information." },
  not_found: { icon: SearchX, title: "Request not found", body: "This case doesn't exist or isn't yours." },
};

/** A verifier's due-diligence case: request, decision, and (if active) the shared information. */
export function DynamicTrustViewPage() {
  const { consentId } = useParams<{ consentId: string }>();
  const { currentUser } = useAuthStore();
  const [request, setRequest] = useState<ConsentRequest | null | undefined>(undefined);
  const [view, setView] = useState<TrustViewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Opening the Trust View is recorded in the business's audit log, so it is
  // fetched only for active cases, once on entry, and on explicit refresh.
  // Concurrent calls (e.g. React StrictMode's dev double-mount) share one request.
  const inFlight = useRef<Promise<void> | null>(null);
  const load = useCallback(() => {
    if (!consentId) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    setRefreshing(true);
    inFlight.current = (async () => {
      try {
        setError(null);
        const all = await api.getOutgoingRequests();
        const found = all.find((item) => item.id === consentId) ?? null;
        setRequest(found);
        setView(found?.status === "active" ? await api.getTrustView(consentId) : null);
      } catch (e) {
        setError(getApiError(e));
      } finally {
        setRefreshing(false);
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [consentId]);

  useEffect(() => { void load(); }, [load]);

  // Re-check once when the access window closes so lapsed access is never shown as live.
  const expiresAt = view?.state === "active" ? view.expiresAt : undefined;
  useEffect(() => {
    const expiry = parseDate(expiresAt)?.getTime();
    if (!expiry) return;
    const delay = expiry - Date.now() + 1000;
    if (delay > 2 ** 31 - 1) return;
    const timer = setTimeout(() => void load(), Math.max(delay, 0));
    return () => clearTimeout(timer);
  }, [expiresAt, load]);

  const home = currentUser?.role === "bank" ? "/bank/dashboard" : "/buyer/dashboard";
  const back = <Button asChild variant="ghost" size="sm" className="-ml-2"><Link to={home}><ArrowLeft className="h-4 w-4" />All cases</Link></Button>;

  if (error) return <div className="space-y-4">{back}<ErrorState message={error} onRetry={() => void load()} /></div>;
  if (request === undefined) return <LoadingState label="Loading case" />;

  const active = view?.state === "active" ? view : null;
  // The backend can report revoked/expired/unavailable on open even if the list said active.
  const closedKey = active ? null : view && view.state !== "active" ? view.state : request?.status ?? "not_found";
  const closed = closedKey === "unavailable" && view?.state === "unavailable"
    ? { icon: ShieldOff, title: "Not available yet", body: view.message }
    : closedKey ? CLOSED_COPY[closedKey] : undefined;
  const badgeStatus = active ? "active" : closedKey === "revoked" || closedKey === "expired" ? closedKey : request?.status;
  const showApproved = request && !["pending", "rejected"].includes(request.status);

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        eyebrow="Verification case"
        title={(active && active.businessName !== "Shared business information" ? active.businessName : request?.businessName) || "Business"}
        description={request ? <>GSTIN <span className="font-mono">{request.businessGstin ?? "—"}</span> · {request.purpose || "Purpose not stated"} · requested {formatDateTime(request.requestedAt)}</> : undefined}
        actions={active ? <Button variant="outline" onClick={() => void load()} disabled={refreshing}><RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Refresh</Button> : undefined}
      />

      {request && (
        <SectionCard title="Overview" action={badgeStatus ? <ConsentStatusBadge status={badgeStatus} /> : undefined}>
          <FactList
            columns={4}
            facts={[
              { label: "Purpose", value: request.purpose || "Not stated" },
              { label: "Requested", value: formatDateTime(request.requestedAt) },
              { label: active ? "Access until" : "Access", value: active ? <>{formatDateTime(active.expiresAt)} <span className="text-xs text-slate-500">({timeUntil(active.expiresAt)})</span></> : request.status === "pending" ? "Not granted yet" : "None now" },
              { label: "Request reference", value: <span className="font-mono">{request.id.slice(-8).toUpperCase()}</span> },
            ]}
          />
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-slate-500">{showApproved ? "What the business approved" : "What you asked for"}</p>
            <ScopeColumns scope={showApproved ? request.approved : request.requested} withheld={showApproved ? withheldScope(request.requested, request.approved) : undefined} />
          </div>
        </SectionCard>
      )}

      {closed && (
        <Card className="flex flex-col items-center px-6 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600"><closed.icon className="h-5 w-5" aria-hidden /></div>
          <h2 className="mt-3 text-base font-semibold text-slate-900">{closed.title}</h2>
          <p className="mt-1 max-w-md text-sm text-slate-600">{closed.body}</p>
        </Card>
      )}

      {active && (
        <>
          {active.fields.length > 0 && (
            <SectionCard title="Shared information" description={`Values as recorded in Trust Profile v${active.profileVersion ?? "—"} when access was approved.`}>
              <div className="grid gap-3 sm:grid-cols-2">{active.fields.map((field) => <SharedFieldRow key={field.key} field={field} />)}</div>
            </SectionCard>
          )}
          {active.evidence.length > 0 && (
            <SectionCard title="Shared evidence" description={`Check status, freshness and dates as of Trust Profile v${active.profileVersion ?? "—"}. Document files are never shared.`}>
              <div className="space-y-3">{active.evidence.map((evidence) => <SharedEvidenceRow key={`${evidence.docType}-${evidence.uploadedAt}`} evidence={evidence} />)}</div>
            </SectionCard>
          )}
          {active.fields.length === 0 && active.evidence.length === 0 && (
            <Card className="p-5 text-sm text-slate-600">None of the approved items exist in the shared Trust Profile version.</Card>
          )}
          <SectionCard title="Trust context">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <FactList
                facts={[
                  { label: "Trust Profile version", value: <span className="inline-flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-slate-500" aria-hidden />Shared from Trust Profile v{active.profileVersion ?? "—"}</span> },
                  { label: "Last checked", value: formatDateTime(active.fields.find((f) => f.lastCheckedAt)?.lastCheckedAt) },
                  { label: "How values were checked", value: describeSource("INTERNAL_DETERMINISTIC_CHECKS") },
                  { label: "Access granted", value: formatDateTime(active.grantedAt) },
                ]}
              />
              <div className="flex gap-2.5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                <p>{NOT_EXTERNALLY_VERIFIED} You can see only what the business approved; files are never shared. Each time you open or refresh this case it is recorded in the business's activity log.</p>
              </div>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
