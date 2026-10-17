import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Building2, FileSearch, Plus, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ConsentStatusBadge } from "@/components/shared/EvidenceStatusBadge";
import { RequesterIdentityDetails } from "@/components/shared/RequesterIdentityBadge";
import { DisclosureSelector } from "@/components/shared/DisclosureSelector";
import * as api from "@/services/api";
import { getApiError } from "@/services/api";
import { captureSession, isStaleSession } from "@/services/sessionEpoch";
import type { ConsentRequest, Role } from "@/types";
import { EVIDENCE_DISCLOSURES, FIELD_DISCLOSURES, scopeCountPhrase, scopeSize, type DisclosureScope } from "@/lib/disclosure";
import { UNVERIFIED_IDENTITY, effectiveAssurance, isRestrictedFor, restrictedItems, restrictionMessage, type RequesterIdentity } from "@/lib/requesterIdentity";
import { useAuthStore } from "@/store/authStore";
import { workspaceLabel } from "@/components/layout/navigation";
import { cn, formatDate, parseDate, timeAgo, timeUntil } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";

const PURPOSES = ["Business Loan", "Vendor Onboarding", "Procurement", "Custom"] as const;
type Purpose = (typeof PURPOSES)[number];
// Suggested starting scopes per purpose; the verifier can change every item before sending.
const PRESETS: Record<Purpose, DisclosureScope> = {
  "Business Loan": { fields: ["legalBusinessName", "gstin", "udyamNumber", "turnoverBand", "summary"], evidence: ["BANK_STATEMENT"] },
  "Vendor Onboarding": { fields: ["legalBusinessName", "gstin", "udyamNumber", "address", "summary"], evidence: ["GST_CERTIFICATE"] },
  Procurement: { fields: ["legalBusinessName", "gstin", "address", "summary"], evidence: ["GST_CERTIFICATE", "UDYAM_CERTIFICATE"] },
  Custom: { fields: ["legalBusinessName", "gstin"], evidence: [] },
};
type Filter = "all" | "waiting" | "active" | "closed";
const FILTERS: { value: Filter; label: string; match: (r: ConsentRequest) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "waiting", label: "Waiting", match: (r) => r.status === "pending" },
  { value: "active", label: "Access granted", match: (r) => r.status === "active" },
  { value: "closed", label: "Closed", match: (r) => ["rejected", "revoked", "expired"].includes(r.status) },
];
const SELECT_CLASS = "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Most recent known event for a case, from fields the API returns. */
function lastActivity(request: ConsentRequest): string | undefined {
  const expiredAt = request.status === "expired" ? request.expiresAt : undefined;
  return [request.revokedAt, expiredAt, request.approvedAt, request.requestedAt]
    .filter(Boolean)
    .sort((a, b) => (parseDate(b)?.getTime() ?? 0) - (parseDate(a)?.getTime() ?? 0))[0];
}

function accessText(request: ConsentRequest): string {
  switch (request.status) {
    case "pending": return "Waiting for the business";
    case "active": return `${scopeSize(request.approved)} of ${scopeSize(request.requested)} items · ${timeUntil(request.expiresAt)}`;
    case "rejected": return "Declined, nothing shared";
    case "revoked": return `Revoked ${formatDate(request.revokedAt)}`;
    case "expired": return `Ended ${formatDate(request.expiresAt)}`;
  }
}

function NewRequestPanel({ identity, onSent, onClose }: { identity: RequesterIdentity; onSent: () => void; onClose: () => void }) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Awaited<ReturnType<typeof api.lookupBusiness>> | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [searching, setSearching] = useState(false);
  const [purpose, setPurpose] = useState<Purpose>("Vendor Onboarding");
  const [selected, setSelected] = useState<DisclosureScope>(PRESETS["Vendor Onboarding"]);
  const [sending, setSending] = useState(false);

  // Explanatory only: the server decides what a requester may ask for.
  const restricted = restrictedItems(selected, identity);
  const restrictedNotes = Object.fromEntries([...FIELD_DISCLOSURES, ...EVIDENCE_DISCLOSURES].filter((item) => isRestrictedFor(item, identity)).map((item) => [item.key, "Needs a reviewed requester. May be refused for your account."]));
  const message = restrictionMessage(identity, restricted);
  const withoutRestricted = () => setSelected({ fields: selected.fields.filter((key) => !restricted.some((item) => item.key === key)), evidence: selected.evidence.filter((key) => !restricted.some((item) => item.key === key)) });

  async function search() {
    if (!query.trim()) return;
    setSearching(true); setNotFound(false);
    try { setFound(await api.lookupBusiness(query)); }
    catch { setFound(null); setNotFound(true); }
    finally { setSearching(false); }
  }

  async function send() {
    if (!found) return;
    setSending(true);
    const session = captureSession();
    try {
      await session.run(api.createConsentRequest({ lookup: found.gstin, purpose, scope: selected }));
      toast({ title: "Request sent", description: `${found.legalName} will decide what to approve and for how long.`, variant: "success" });
      onSent();
    } catch (e) {
      if (isStaleSession(e)) return;
      toast({ title: "Request failed", description: getApiError(e), variant: "destructive" });
    } finally { setSending(false); }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">New verification request</h2>
          <p className="mt-0.5 text-sm text-slate-600">Ask a registered MSME for specific information. They decide what to share and for how long.</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close new request"><X className="h-4 w-4" /></Button>
      </div>

      <div className="mt-4">
        <Label htmlFor="gstin-search">1. Find the business by GSTIN</Label>
        <div className="mt-1.5 flex gap-2">
          <Input id="gstin-search" aria-label="MSME GSTIN" placeholder="e.g. 33ABCDE1234F1Z5" className="font-mono uppercase" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
          <Button variant="outline" onClick={() => void search()} disabled={searching}><Search className="h-4 w-4" />{searching ? "Finding…" : "Find"}</Button>
        </div>
        {notFound && <p role="alert" className="mt-2 text-sm text-negative-foreground">No registered business has that GSTIN. Check it and try again.</p>}
      </div>

      {found && (
        <div className="mt-5 space-y-5 border-t border-slate-100 pt-5">
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-600 shadow-subtle"><Building2 className="h-4 w-4" aria-hidden /></div>
            <div><p className="text-sm font-semibold text-slate-900">{found.legalName}</p><p className="font-mono text-xs text-slate-500">GSTIN {found.gstin}</p></div>
          </div>
          <div className="max-w-xs">
            <Label htmlFor="purpose">2. Purpose</Label>
            <select id="purpose" className={cn(SELECT_CLASS, "mt-1.5")} value={purpose} onChange={(e) => { const next = e.target.value as Purpose; setPurpose(next); setSelected(PRESETS[next]); }}>
              {PURPOSES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-900">3. What you're asking for <span className="font-normal text-slate-500">· ask only for what you need</span></p>
            <DisclosureSelector idPrefix="request" value={selected} onChange={setSelected} notes={restrictedNotes} />
            {message && (
              <div role="status" className="mt-3 flex flex-col gap-2 rounded-lg border border-warning-border bg-warning-bg p-3 text-sm text-warning-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>{message}</p>
                <Button variant="outline" size="sm" className="shrink-0" onClick={withoutRestricted}>Remove these items</Button>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3 rounded-lg bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-700">You are about to request {scopeCountPhrase(selected)} from <span className="font-medium">{found.legalName}</span> for {purpose.toLowerCase()}.</p>
            <Button onClick={() => void send()} disabled={sending || scopeSize(selected) === 0}>{sending ? "Sending…" : "Send Request"}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function StakeholderDashboard({ role, helperText }: { role: Extract<Role, "buyer" | "bank">; helperText: string }) {
  const { toast } = useToast();
  const currentUser = useAuthStore((state) => state.currentUser);
  const identity = currentUser?.requesterIdentity;
  const [requests, setRequests] = useState<ConsentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const session = captureSession();
    try { setRequests(await session.run(api.getOutgoingRequests())); }
    catch (e) { if (isStaleSession(e)) return; toast({ title: "Workspace unavailable", description: getApiError(e), variant: "destructive" }); }
    finally { setLoading(false); }
  }, [toast]);

  // Load on entry and when the tab regains focus (e.g. after the MSME approves).
  // Listing cases is read-only and is not recorded as a Trust View.
  useEffect(() => {
    void load();
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, requests.filter(f.match).length])) as Record<Filter, number>, [requests]);
  const cases = useMemo(() => requests.filter(FILTERS.find((f) => f.value === filter)!.match), [requests, filter]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={workspaceLabel(role)}
        title="Verification cases"
        description={helperText}
        actions={<>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />Refresh</Button>
          {!composing && <Button onClick={() => setComposing(true)}><Plus className="h-4 w-4" />New request</Button>}
        </>}
      />

      {currentUser && identity && (
        <details className="group rounded-lg border border-border bg-white p-4 shadow-card" open={effectiveAssurance(identity).level !== "AUTHORIZED"}>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">How businesses see your organization</summary>
          <RequesterIdentityDetails className="mt-3" identity={identity} fallbackName={currentUser.orgName} />
        </details>
      )}

      {(composing || (!loading && requests.length === 0)) && <NewRequestPanel identity={identity ?? UNVERIFIED_IDENTITY} onSent={() => { setComposing(false); void load(); }} onClose={() => setComposing(false)} />}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter cases">
        {FILTERS.map((f) => (
          <Button key={f.value} size="sm" variant={filter === f.value ? "default" : "outline"} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}<span className={cn("rounded-full px-1.5 text-[11px] font-semibold", filter === f.value ? "bg-white/20" : "bg-slate-100 text-slate-600")}>{counts[f.value]}</span>
          </Button>
        ))}
      </div>

      {loading && requests.length === 0 ? (
        <div className="space-y-2" role="status" aria-label="Loading cases"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : cases.length === 0 ? (
        <EmptyState icon={FileSearch} title={requests.length ? "No cases in this view" : "No verification cases yet"} description={requests.length ? "Try another filter." : "Send your first request above. The business decides what you can see."} />
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_auto] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-medium text-slate-500 lg:grid">
            <span>Business</span><span>Purpose</span><span>Status</span><span>Access</span><span>Last activity</span><span className="w-24" />
          </div>
          <ul className="divide-y divide-slate-100">
            {cases.map((request) => (
              <li key={request.id} className="grid grid-cols-1 gap-2 px-5 py-4 transition-colors hover:bg-slate-50/70 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_auto] lg:items-center lg:gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{request.businessName || "Business name unavailable"}</p>
                  <p className="truncate font-mono text-xs text-slate-500">{request.businessGstin ? `GSTIN ${request.businessGstin}` : ""}</p>
                </div>
                <p className="text-sm text-slate-700"><span className="text-xs text-slate-500 lg:hidden">Purpose: </span>{request.purpose || "Not stated"}</p>
                <div><ConsentStatusBadge status={request.status} /></div>
                <p className="text-sm text-slate-700">{accessText(request)}</p>
                <p className="text-xs text-slate-500">{timeAgo(lastActivity(request))}</p>
                <Button asChild size="sm" variant={request.status === "active" ? "default" : "outline"} className="w-full lg:w-24">
                  <Link to={`/trust-view/${request.id}`} aria-label={`Open case for ${request.businessName ?? "business"}`}>Open<ArrowRight className="h-3.5 w-3.5" /></Link>
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
